/**
 * Desktop ManagedRuntimeInstaller — HTTPS tarball fetch + extract.
 *
 * Fetch order (design §4):
 * 1. R2 CDN (`dl.super-one.dev/harness/...`) via channel manifest pin
 * 2. npm registry tarball for the same version
 *
 * Integrity: channel pin SHA-256 is authoritative when a manifest is available
 * (validates both R2 and npm bytes). Without a manifest, npm `dist.integrity`
 * (sha512) is used. Extract uses system `tar` so exec bits survive (P0).
 *
 * Layout matches CLI `managed-npm/<id>/` so resolveOfficialInstallBinary works.
 */

import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import {
  OFFICIAL_CLAUDE_SDK_VERSION,
  OFFICIAL_CODEX_NPM_VERSION,
  OFFICIAL_CODEX_PACKAGE,
  claudePlatformPackageName,
  currentHostArch,
  currentHostPlatform,
  fetchHarnessChannelManifest,
  isHarnessManifestChannel,
  managedNpmPrefix,
  resolveOfficialInstallBinary,
  selectHarnessArtifact,
  type HarnessManifestChannel,
  type ManagedArtifactPin,
  type ManagedHarnessId,
  type ManagedRuntimeInstaller,
  type InstalledManagedRuntime,
  type HarnessHome,
} from '@superone/runtime/harness'
import { channelFromVersion } from '@superone/shared/update-channels'
import log from '../logger'

const NPM_REGISTRY = 'https://registry.npmjs.org'

export interface NpmPackMeta {
  name: string
  version: string
  tarball: string
  /** npm `dist.integrity` — `sha512-<base64>` */
  integrity: string
}

export interface TarballFetchFns {
  /** GET JSON (registry metadata / channel manifest). */
  fetchJson: (url: string) => Promise<unknown>
  /** GET binary body as stream-like async iterable or Response-like. */
  fetchBinary: (
    url: string,
    onProgress?: (received: number, total: number) => void,
  ) => Promise<Uint8Array>
  /** Extract .tgz into destDir (must produce a `package/` child). */
  extractTgz: (tgzPath: string, destDir: string) => Promise<void>
}

export interface DesktopInstallerOptions extends Partial<TarballFetchFns> {
  /** Override harness manifest channel. Default: env → app version channel. */
  channel?: HarnessManifestChannel
  /** CDN base (default https://dl.super-one.dev). */
  cdnBase?: string
  /** Skip R2 and go straight to npm (tests / air-gapped without mirror). */
  npmOnly?: boolean
  /**
   * Injectable channel pin. When set, skips the network manifest fetch.
   * Tests pass a synthetic pin; production leaves this undefined.
   */
  artifactPin?: ManagedArtifactPin | null
}

/** Resolve which harness channel manifest to use. */
export function resolveHarnessManifestChannel(
  explicit?: HarnessManifestChannel,
  appVersion?: string,
): HarnessManifestChannel {
  if (explicit) return explicit
  const fromEnv = process.env.SUPERONE_HARNESS_CHANNEL?.trim()
  if (fromEnv && isHarnessManifestChannel(fromEnv)) return fromEnv
  const ver =
    appVersion?.trim() ||
    process.env.SUPERONE_CLI_VERSION?.trim() ||
    process.env.npm_package_version?.trim() ||
    ''
  if (ver) {
    const ch = channelFromVersion(ver)
    if (isHarnessManifestChannel(ch)) return ch
  }
  return 'alpha'
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function verifySha256(bytes: Uint8Array, expectedHex: string): void {
  const actual = sha256Hex(bytes)
  if (actual !== expectedHex.toLowerCase()) {
    throw new Error(`tarball sha256 mismatch: expected ${expectedHex}, got ${actual}`)
  }
}

function defaultFetchJson(url: string): Promise<unknown> {
  return fetch(url, { headers: { accept: 'application/json' } }).then(async (res) => {
    if (!res.ok) throw new Error(`registry GET ${url} → ${res.status}`)
    return res.json()
  })
}

async function defaultFetchBinary(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`tarball GET ${url} → ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onProgress?.(buf.byteLength, total || buf.byteLength)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      onProgress?.(received, total || received)
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** System tar — preserves mode bits (required for codex nested bins). */
export function extractTgzWithSystemTar(tgzPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destDir, { recursive: true })
    const child = spawn('tar', ['-xzf', tgzPath, '-C', destDir], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', (err) => reject(new Error(`tar spawn failed: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar extract failed (exit ${code}): ${stderr.slice(-500)}`))
    })
  })
}

/**
 * Codex platform version on npm is the base version plus a platform suffix
 * (`0.146.1-darwin-arm64`). The package *name* stays `@openai/codex`.
 */
export function codexPlatformVersion(baseVersion = OFFICIAL_CODEX_NPM_VERSION): string {
  const p = process.platform
  const a = process.arch
  if (a !== 'arm64' && a !== 'x64') {
    throw new Error(`unsupported arch for Codex: ${a}`)
  }
  if (p === 'darwin') return `${baseVersion}-darwin-${a}`
  if (p === 'linux') return `${baseVersion}-linux-${a}`
  if (p === 'win32') return `${baseVersion}-win32-${a}`
  throw new Error(`unsupported platform for Codex: ${p}`)
}

/** Which npm packages (name@version) the desktop fetcher must pull for a harness. */
export function desktopPackagePins(id: ManagedHarnessId): {
  runtimeVersion: string
  packages: Array<{ name: string; version: string; nodeModulesDir: string }>
} {
  if (id === 'claude') {
    const ver = process.env.SUPERONE_CLAUDE_SDK_VERSION?.trim() || OFFICIAL_CLAUDE_SDK_VERSION
    const platform = claudePlatformPackageName()
    // Only the platform package carries the native binary; TS SDK stays in the app.
    return {
      runtimeVersion: ver,
      packages: [
        {
          name: platform,
          version: ver,
          // Scoped layout: lib/node_modules/@anthropic-ai/claude-agent-sdk-…
          nodeModulesDir: platform,
        },
      ],
    }
  }
  const base = process.env.SUPERONE_CODEX_NPM_VERSION?.trim() || OFFICIAL_CODEX_NPM_VERSION
  const ver = codexPlatformVersion(base)
  return {
    runtimeVersion: base,
    packages: [
      {
        name: OFFICIAL_CODEX_PACKAGE,
        version: ver,
        nodeModulesDir: OFFICIAL_CODEX_PACKAGE,
      },
    ],
  }
}

export async function resolveNpmPackMeta(
  name: string,
  version: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
): Promise<NpmPackMeta> {
  // Scoped packages: @scope/name → /@scope%2fname/version
  const encoded = name.startsWith('@')
    ? `/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`
    : `/${name}/${encodeURIComponent(version)}`
  const url = `${NPM_REGISTRY}${encoded}`
  const raw = (await fetchJson(url)) as Record<string, unknown>
  const dist = raw.dist as { tarball?: string; integrity?: string } | undefined
  if (!dist?.tarball || !dist.integrity) {
    throw new Error(`npm package ${name}@${version} missing dist.tarball/integrity`)
  }
  if (!dist.integrity.startsWith('sha512-')) {
    throw new Error(`npm package ${name}@${version} integrity is not sha512: ${dist.integrity}`)
  }
  return {
    name,
    version: typeof raw.version === 'string' ? raw.version : version,
    tarball: dist.tarball,
    integrity: dist.integrity,
  }
}

export function verifyNpmIntegrity(bytes: Uint8Array, integrity: string): void {
  if (!integrity.startsWith('sha512-')) {
    throw new Error(`unsupported integrity algorithm: ${integrity.slice(0, 16)}`)
  }
  const expected = integrity.slice('sha512-'.length)
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (actual !== expected) {
    throw new Error(`tarball integrity mismatch (sha512)`)
  }
}

/**
 * Place an extracted npm `package/` directory into
 * `prefix/lib/node_modules/<scope>/<name>/` via sibling staging + rename.
 */
export function installPackageDir(
  packageDir: string,
  prefix: string,
  nodeModulesRel: string,
): string {
  // Scoped packages: "@anthropic-ai/foo" → lib/node_modules/@anthropic-ai/foo
  const dest = join(prefix, 'lib', 'node_modules', ...nodeModulesRel.split('/'))
  const parent = dirname(dest)
  mkdirSync(parent, { recursive: true })
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  const staging = join(
    parent,
    `.staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  try {
    renameSync(packageDir, staging)
    renameSync(staging, dest)
  } catch (err) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    throw err instanceof Error
      ? err
      : new Error(`failed to place package into ${dest}: ${String(err)}`)
  }
  return dest
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  await pipeline(Readable.from([bytes]), createWriteStream(path))
}

export function createDesktopTarballInstaller(
  opts: DesktopInstallerOptions = {},
): ManagedRuntimeInstaller {
  const fetchJson = opts.fetchJson ?? defaultFetchJson
  const fetchBinary = opts.fetchBinary ?? defaultFetchBinary
  const extractTgz = opts.extractTgz ?? extractTgzWithSystemTar

  return {
    async install(
      id: ManagedHarnessId,
      home: HarnessHome,
      onProgress?: (received: number, total: number) => void,
    ): Promise<InstalledManagedRuntime> {
      const prefix = managedNpmPrefix(home.root, id)
      mkdirSync(prefix, { recursive: true })

      // Fast path: already installed
      const existing = resolveDesktopManagedBinary(id, prefix)
      if (existing) {
        return {
          command: existing,
          runtimeVersion: readRuntimeVersion(id, prefix) ?? desktopPackagePins(id).runtimeVersion,
          source: 'npm-tarball',
          detail: { installPrefix: prefix, reused: '1' },
        }
      }

      const pins = desktopPackagePins(id)
      const channel = resolveHarnessManifestChannel(opts.channel)
      const artifactPin = await resolveArtifactPin(id, channel, opts, fetchJson)

      let packageSpec = ''
      let source: 'r2-tarball' | 'npm-tarball' = 'npm-tarball'

      for (const pkg of pins.packages) {
        // Prefer npm identity from the channel pin when present (codex platform version).
        const npmName = artifactPin?.npmName ?? pkg.name
        const npmVersion = artifactPin?.npmVersion ?? pkg.version
        packageSpec = `${npmName}@${npmVersion}`

        const { bytes, from } = await fetchTarballBytes({
          npmName,
          npmVersion,
          pin: artifactPin,
          npmOnly: opts.npmOnly === true,
          fetchJson,
          fetchBinary,
          onProgress,
        })
        source = from

        const work = mkdtempSync(join(tmpdir(), `superone-harness-${id}-`))
        try {
          const tgzPath = join(work, 'payload.tgz')
          await writeBytes(tgzPath, bytes)
          const extractRoot = join(work, 'out')
          await extractTgz(tgzPath, extractRoot)
          const packageDir = join(extractRoot, 'package')
          if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
            throw new Error(`tarball for ${packageSpec} has no package/ directory`)
          }
          installPackageDir(packageDir, prefix, npmName)
        } finally {
          rmSync(work, { recursive: true, force: true })
        }
      }

      writeFileSync(
        join(prefix, 'install-meta.json'),
        JSON.stringify(
          {
            harnessId: id,
            runtimeVersion: pins.runtimeVersion,
            packageSpec,
            source,
            channel,
            digestSha256: artifactPin?.digestSha256 ?? null,
            installedAt: Date.now(),
          },
          null,
          2,
        ),
      )

      const command = resolveDesktopManagedBinary(id, prefix)
      if (!command) {
        throw new Error(
          `tarball install of ${id} succeeded but binary was not found under ${prefix}`,
        )
      }
      log.info(`[harness] installed ${id} from ${source} → ${command}`)
      return {
        command,
        runtimeVersion: pins.runtimeVersion,
        source,
        detail: {
          packageSpec,
          installPrefix: prefix,
          channel,
          digestSha256: artifactPin?.digestSha256,
        },
      }
    },
  }
}

async function resolveArtifactPin(
  id: ManagedHarnessId,
  channel: HarnessManifestChannel,
  opts: DesktopInstallerOptions,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<ManagedArtifactPin | null> {
  if (opts.artifactPin !== undefined) return opts.artifactPin
  if (opts.npmOnly) return null
  try {
    const manifest = await fetchHarnessChannelManifest({
      channel,
      baseUrl: opts.cdnBase,
      fetchJson,
    })
    const pin = selectHarnessArtifact(manifest, id, currentHostPlatform(), currentHostArch())
    if (pin) {
      log.info(
        `[harness] channel manifest ${channel}: ${id} ${pin.platform}/${pin.arch} digest=${pin.digestSha256.slice(0, 12)}…`,
      )
    }
    return pin
  } catch (err) {
    log.warn(
      `[harness] channel manifest ${channel} unavailable (${err instanceof Error ? err.message : String(err)}); falling back to npm`,
    )
    return null
  }
}

async function fetchTarballBytes(opts: {
  npmName: string
  npmVersion: string
  pin: ManagedArtifactPin | null
  npmOnly: boolean
  fetchJson: (url: string) => Promise<unknown>
  fetchBinary: (
    url: string,
    onProgress?: (received: number, total: number) => void,
  ) => Promise<Uint8Array>
  onProgress?: (received: number, total: number) => void
}): Promise<{ bytes: Uint8Array; from: 'r2-tarball' | 'npm-tarball' }> {
  const { npmName, npmVersion, pin, npmOnly, fetchJson, fetchBinary, onProgress } = opts
  const expectedSha = pin?.digestSha256

  // 1) R2 primary
  if (!npmOnly && pin?.url) {
    try {
      log.info(`[harness] fetching R2 ${pin.url}`)
      const bytes = await fetchBinary(pin.url, onProgress)
      if (expectedSha) verifySha256(bytes, expectedSha)
      return { bytes, from: 'r2-tarball' }
    } catch (err) {
      log.warn(
        `[harness] R2 fetch failed (${err instanceof Error ? err.message : String(err)}); trying npm`,
      )
    }
  }

  // 2) npm registry fallback
  log.info(`[harness] fetching npm ${npmName}@${npmVersion}`)
  const meta = await resolveNpmPackMeta(npmName, npmVersion, fetchJson)
  const bytes = await fetchBinary(meta.tarball, onProgress)
  if (expectedSha) {
    // Same bytes as R2 mirror — one digest validates both paths.
    verifySha256(bytes, expectedSha)
  } else {
    verifyNpmIntegrity(bytes, meta.integrity)
  }
  return { bytes, from: 'npm-tarball' }
}

/**
 * Resolve the runnable binary after a desktop tarball install.
 * Claude: native platform package binary.
 * Codex: prefer vendor native binary (app-server protocol); fall back to npm bin.
 */
export function resolveDesktopManagedBinary(
  id: ManagedHarnessId,
  prefix: string,
): string | null {
  if (id === 'claude') {
    return resolveOfficialInstallBinary('claude', prefix)
  }
  // codex: native binary under vendor/<triple>/bin/codex
  const native = resolveCodexNativeUnderPrefix(prefix)
  if (native) return native
  return resolveOfficialInstallBinary('codex', prefix)
}

function resolveCodexNativeUnderPrefix(prefix: string): string | null {
  const triple = codexTargetTriple()
  if (!triple) return null
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [
    join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'vendor', triple, 'bin', binaryName),
    // alias-style layout if we ever install under codex-<platform>
    join(
      prefix,
      'lib',
      'node_modules',
      '@openai',
      `codex-${process.platform}-${process.arch}`,
      'vendor',
      triple,
      'bin',
      binaryName,
    ),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function codexTargetTriple(): string | null {
  const key = `${process.platform}-${process.arch}`
  const map: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  }
  return map[key] ?? null
}

function readRuntimeVersion(id: ManagedHarnessId, prefix: string): string | null {
  try {
    const metaPath = join(prefix, 'install-meta.json')
    if (existsSync(metaPath)) {
      const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as { runtimeVersion?: string }
      if (raw.runtimeVersion) return raw.runtimeVersion
    }
  } catch {
    /* fall through */
  }
  try {
    const pkgPath =
      id === 'claude'
        ? null // platform package version is fine; no main package required
        : join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'package.json')
    if (pkgPath && existsSync(pkgPath)) {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
      // strip platform suffix if present
      const v = raw.version?.trim()
      if (!v) return null
      return v.replace(/-(darwin|linux|win32)-(arm64|x64)$/, '')
    }
  } catch {
    /* ignore */
  }
  return null
}
