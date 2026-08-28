/**
 * Shared managed harness installer: R2/CDN tarball first, npm pack fallback.
 *
 * Used by both desktop and CLI. Hosts inject HTTP (`httpFetch` / `downloadToFile`);
 * desktop typically passes Electron `net.fetch` + Range-resumable download.
 * CLI uses undici `fetch` and a simple stream-to-disk default.
 *
 * Layout: `<harnessHome>/<id>/versions/<runtimeVersion>/` + `current`
 * (see `managed-layout.ts` / `home-path.ts`).
 */

import {
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
import { spawn } from 'node:child_process'
import { channelFromVersion } from '@superone/shared/update-channels'
import {
  fetchHarnessChannelManifest,
  isHarnessManifestChannel,
  selectHarnessArtifact,
  type HarnessManifestChannel,
} from './cdn'
import {
  managedVersionDir,
  pruneManagedVersions,
  readCurrentPointer,
  resolveActiveInstallRoot,
  writeCurrentPointer,
} from './managed-layout'
import {
  OFFICIAL_CLAUDE_SDK_VERSION,
  OFFICIAL_CODEX_NPM_VERSION,
  OFFICIAL_CODEX_PACKAGE,
  claudePlatformPackageName,
  codexPlatformPackageVersion,
  managedHarnessPrefix,
  resolveOfficialInstallBinaryInRoot,
} from './managed-official'
import {
  currentHostArch,
  currentHostPlatform,
  type ManagedArtifactPin,
  type ManagedHarnessId,
} from './managed-release'
import { createResumableDownloadToFile } from './resumable-download'
import {
  createFetchJson,
  fetchTarballWithFallback,
  type DownloadToFile,
  type FetchJson,
  type HttpFetch,
  type TarballSource,
} from './tarball-fetch'
import type { HarnessHome, InstalledManagedRuntime, ManagedRuntimeInstaller } from './types'

// ── package pins ────────────────────────────────────────────────────────────

export function codexPlatformVersion(baseVersion = OFFICIAL_CODEX_NPM_VERSION): string {
  return codexPlatformPackageVersion(baseVersion)
}

/** Which npm packages the tarball installer pulls for a managed harness. */
export function managedPackagePins(id: ManagedHarnessId): {
  runtimeVersion: string
  packages: Array<{ name: string; version: string; nodeModulesDir: string }>
} {
  if (id === 'claude') {
    const ver = process.env.SUPERONE_CLAUDE_SDK_VERSION?.trim() || OFFICIAL_CLAUDE_SDK_VERSION
    const platform = claudePlatformPackageName()
    return {
      runtimeVersion: ver,
      packages: [{ name: platform, version: ver, nodeModulesDir: platform }],
    }
  }
  const base = process.env.SUPERONE_CODEX_NPM_VERSION?.trim() || OFFICIAL_CODEX_NPM_VERSION
  return {
    runtimeVersion: base,
    packages: [
      {
        name: OFFICIAL_CODEX_PACKAGE,
        version: codexPlatformPackageVersion(base),
        nodeModulesDir: OFFICIAL_CODEX_PACKAGE,
      },
    ],
  }
}

// ── channel ─────────────────────────────────────────────────────────────────

export function resolveHarnessManifestChannel(
  explicit?: HarnessManifestChannel,
  releaseVersion?: string,
): HarnessManifestChannel {
  if (explicit) return explicit
  const fromEnv = process.env.SUPERONE_HARNESS_CHANNEL?.trim()
  if (fromEnv && isHarnessManifestChannel(fromEnv)) return fromEnv
  const ver =
    releaseVersion?.trim() ||
    process.env.SUPERONE_CLI_VERSION?.trim() ||
    process.env.npm_package_version?.trim() ||
    ''
  if (ver) {
    const ch = channelFromVersion(ver)
    if (isHarnessManifestChannel(ch)) return ch
  }
  return 'alpha'
}

// ── partial download paths ──────────────────────────────────────────────────

export function harnessDownloadDir(homeRoot: string): string {
  return join(homeRoot, '.download')
}

export function harnessArtifactDownloadKey(opts: {
  harnessId: ManagedHarnessId
  digestSha256?: string | null
  npmName: string
  npmVersion: string
}): string {
  const digest = opts.digestSha256?.trim().toLowerCase()
  if (digest && /^[a-f0-9]{16,}$/.test(digest)) {
    return `${opts.harnessId}-${digest.slice(0, 24)}`
  }
  const safe = `${opts.npmName}@${opts.npmVersion}`
    .replace(/^@/, '')
    .replace(/[^A-Za-z0-9._+-]+/g, '_')
    .slice(0, 120)
  return `${opts.harnessId}-${safe}`
}

export function harnessPartialPath(homeRoot: string, key: string): string {
  if (!key || key.includes('..') || key.includes('/') || key.includes('\\')) {
    throw new Error(`unsafe download key: ${key}`)
  }
  return join(harnessDownloadDir(homeRoot), `${key}.partial`)
}

// ── extract + place ─────────────────────────────────────────────────────────

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

export function installPackageDir(
  packageDir: string,
  prefix: string,
  nodeModulesRel: string,
): string {
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

// ── binary resolve ──────────────────────────────────────────────────────────

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

function resolveCodexNativeUnderPrefix(prefix: string): string | null {
  const triple = codexTargetTriple()
  if (!triple) return null
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [
    join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'vendor', triple, 'bin', binaryName),
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

/** Resolve binary inside a concrete version dir. */
export function resolveManagedTarballBinary(
  id: ManagedHarnessId,
  installRoot: string,
): string | null {
  if (id === 'claude') return resolveOfficialInstallBinaryInRoot('claude', installRoot)
  return resolveCodexNativeUnderPrefix(installRoot) ?? resolveOfficialInstallBinaryInRoot('codex', installRoot)
}

/** Resolve via `current` pointer under `<home>/<id>`. */
export function resolveManagedTarballBinaryFromPrefix(
  id: ManagedHarnessId,
  prefix: string,
): string | null {
  const root = resolveActiveInstallRoot(prefix)
  if (!root) return null
  return resolveManagedTarballBinary(id, root)
}

export function readRuntimeVersionFromRoot(
  id: ManagedHarnessId,
  installRoot: string,
): string | null {
  let metadataVersion: string | null = null
  try {
    const metaPath = join(installRoot, 'install-meta.json')
    if (existsSync(metaPath)) {
      const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as { runtimeVersion?: string }
      metadataVersion = raw.runtimeVersion?.trim() || null
    }
  } catch {
    /* fall through */
  }
  try {
    const pkgPath =
      id === 'claude'
        ? null
        : join(installRoot, 'lib', 'node_modules', '@openai', 'codex', 'package.json')
    if (pkgPath && existsSync(pkgPath)) {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
      const v = raw.version?.trim()
      if (!v) return null
      return v.replace(/-(darwin|linux|win32)-(arm64|x64)$/, '')
    }
  } catch {
    /* ignore */
  }
  return metadataVersion
}

export function readRuntimeVersion(id: ManagedHarnessId, prefix: string): string | null {
  const pointer = readCurrentPointer(prefix)
  if (pointer?.runtimeVersion) {
    const root = managedVersionDir(prefix, pointer.runtimeVersion)
    const fromMeta = readRuntimeVersionFromRoot(id, root)
    if (fromMeta) return fromMeta
    return pointer.runtimeVersion
  }
  const root = resolveActiveInstallRoot(prefix)
  if (!root) return null
  return readRuntimeVersionFromRoot(id, root)
}

// ── installer factory ───────────────────────────────────────────────────────

export interface ManagedTarballInstallerOptions {
  httpFetch?: HttpFetch
  fetchJson?: FetchJson
  /**
   * Stream GET body to disk. Default: Range-resumable download
   * (`createResumableDownloadToFile`) — used by both CLI and desktop.
   */
  downloadToFile?: DownloadToFile
  extractTgz?: (tgzPath: string, destDir: string) => Promise<void>
  channel?: HarnessManifestChannel
  /** Used with channelFromVersion when channel is not explicit. */
  releaseVersion?: string
  cdnBase?: string
  npmOnly?: boolean
  artifactPin?: ManagedArtifactPin | null
  log?: {
    info?: (msg: string) => void
    warn?: (msg: string) => void
  }
}

async function resolveArtifactPin(
  id: ManagedHarnessId,
  channel: HarnessManifestChannel,
  opts: ManagedTarballInstallerOptions,
  fetchJson: FetchJson,
): Promise<ManagedArtifactPin | null> {
  if (opts.artifactPin !== undefined) return opts.artifactPin
  if (opts.npmOnly) return null
  try {
    const manifest = await fetchHarnessChannelManifest({
      channel,
      baseUrl: opts.cdnBase,
      fetchJson,
    })
    return selectHarnessArtifact(manifest, id, currentHostPlatform(), currentHostArch())
  } catch (err) {
    opts.log?.warn?.(
      `[harness] channel manifest ${channel} unavailable (${err instanceof Error ? err.message : String(err)}); falling back to npm`,
    )
    return null
  }
}

/**
 * Create the shared R2→npm tarball installer for any host.
 */
export function createManagedTarballInstaller(
  opts: ManagedTarballInstallerOptions = {},
): ManagedRuntimeInstaller {
  const httpFetch = opts.httpFetch ?? ((input, init) => globalThis.fetch(input, init))
  const fetchJson = opts.fetchJson ?? createFetchJson(httpFetch)
  const log = opts.log
  const downloadToFile =
    opts.downloadToFile ?? createResumableDownloadToFile(httpFetch, log)
  const extractTgz = opts.extractTgz ?? extractTgzWithSystemTar

  return {
    async install(
      id: ManagedHarnessId,
      home: HarnessHome,
      onProgress?: (received: number, total: number) => void,
    ): Promise<InstalledManagedRuntime> {
      const prefix = managedHarnessPrefix(home.root, id)
      mkdirSync(prefix, { recursive: true })

      const pins = managedPackagePins(id)
      const versionDir = managedVersionDir(prefix, pins.runtimeVersion)
      const previousPointer = readCurrentPointer(prefix)?.runtimeVersion ?? null

      const versionBin = resolveManagedTarballBinary(id, versionDir)
      const versionMeta = readRuntimeVersionFromRoot(id, versionDir)
      if (versionBin && versionMeta === pins.runtimeVersion) {
        writeCurrentPointer(prefix, pins.runtimeVersion, { installRoot: versionDir })
        return {
          command: versionBin,
          runtimeVersion: pins.runtimeVersion,
          source: 'npm-tarball',
          detail: {
            installPrefix: versionDir,
            reused: '1',
            runtimeVersion: pins.runtimeVersion,
          },
        }
      }

      const activeRoot = resolveActiveInstallRoot(prefix)
      if (activeRoot) {
        const activeBin = resolveManagedTarballBinary(id, activeRoot)
        const activeVer = readRuntimeVersionFromRoot(id, activeRoot)
        if (activeBin && activeVer === pins.runtimeVersion) {
          writeCurrentPointer(prefix, pins.runtimeVersion, { installRoot: activeRoot })
          return {
            command: activeBin,
            runtimeVersion: activeVer,
            source: 'npm-tarball',
            detail: { installPrefix: activeRoot, reused: '1' },
          }
        }
        if (activeBin && activeVer && activeVer !== pins.runtimeVersion) {
          log?.info?.(
            `[harness] ${id} pin mismatch: installed=${activeVer} pin=${pins.runtimeVersion} — installing side-by-side`,
          )
        }
      }

      const channel = resolveHarnessManifestChannel(opts.channel, opts.releaseVersion)
      const artifactPin = await resolveArtifactPin(id, channel, opts, fetchJson)
      const compatibleArtifactPin = artifactPin && pins.packages.some(
        (pkg) => pkg.name === artifactPin.npmName && pkg.version === artifactPin.npmVersion,
      )
        ? artifactPin
        : null
      if (artifactPin && !compatibleArtifactPin) {
        log?.warn?.(
          `[harness] ignoring stale ${id} artifact ${artifactPin.npmName}@${artifactPin.npmVersion}; requested ${pins.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`,
        )
      }

      let packageSpec = ''
      let source: TarballSource = 'npm-tarball'
      mkdirSync(versionDir, { recursive: true })

      for (const pkg of pins.packages) {
        const npmName = compatibleArtifactPin?.npmName ?? pkg.name
        const npmVersion = compatibleArtifactPin?.npmVersion ?? pkg.version
        packageSpec = `${npmName}@${npmVersion}`

        const downloadKey = harnessArtifactDownloadKey({
          harnessId: id,
          digestSha256: compatibleArtifactPin?.digestSha256,
          npmName,
          npmVersion,
        })
        const partialPath = harnessPartialPath(home.root, downloadKey)

        const work = mkdtempSync(join(tmpdir(), `superone-harness-${id}-`))
        try {
          const { from } = await fetchTarballWithFallback({
            destPath: partialPath,
            npmName,
            npmVersion,
            pin: compatibleArtifactPin,
            npmOnly: opts.npmOnly === true,
            fetchJson,
            downloadToFile,
            onProgress,
            log,
          })
          source = from

          const extractRoot = join(work, 'out')
          await extractTgz(partialPath, extractRoot)
          const packageDir = join(extractRoot, 'package')
          if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
            throw new Error(`tarball for ${packageSpec} has no package/ directory`)
          }
          installPackageDir(packageDir, versionDir, npmName)
          try {
            if (existsSync(partialPath)) rmSync(partialPath, { force: true })
          } catch {
            /* best-effort */
          }
        } finally {
          rmSync(work, { recursive: true, force: true })
        }
      }

      writeFileSync(
        join(versionDir, 'install-meta.json'),
        JSON.stringify(
          {
            harnessId: id,
            runtimeVersion: pins.runtimeVersion,
            packageSpec,
            source,
            channel,
            digestSha256: compatibleArtifactPin?.digestSha256 ?? null,
            installedAt: Date.now(),
          },
          null,
          2,
        ),
      )

      const command = resolveManagedTarballBinary(id, versionDir)
      if (!command) {
        throw new Error(
          `tarball install of ${id} succeeded but binary was not found under ${versionDir}`,
        )
      }
      writeCurrentPointer(prefix, pins.runtimeVersion, { installRoot: versionDir })
      const keep = [pins.runtimeVersion, previousPointer].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
      pruneManagedVersions(prefix, keep)

      log?.info?.(`[harness] installed ${id}@${pins.runtimeVersion} from ${source} → ${command}`)
      return {
        command,
        runtimeVersion: pins.runtimeVersion,
        source,
        detail: {
          packageSpec,
          installPrefix: versionDir,
          channel,
          digestSha256: compatibleArtifactPin?.digestSha256,
          runtimeVersion: pins.runtimeVersion,
        },
      }
    },
  }
}

export function isManagedPinAligned(id: ManagedHarnessId, homeRoot: string): boolean {
  const prefix = managedHarnessPrefix(homeRoot, id)
  const pin = managedPackagePins(id).runtimeVersion
  const bin = resolveManagedTarballBinaryFromPrefix(id, prefix)
  const ver = readRuntimeVersion(id, prefix)
  return Boolean(bin && ver === pin)
}
