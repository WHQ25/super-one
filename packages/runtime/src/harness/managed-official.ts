/**
 * Install managed harness runtimes from **official** npm packages.
 *
 * - Claude: @anthropic-ai/claude-agent-sdk + platform optional package (same family as desktop)
 * - Codex: @openai/codex
 *
 * Layout (shared with desktop — root is `~/.superone/harness`, see `home-path.ts`):
 * ```
 * <harnessHome>/<id>/versions/<runtimeVersion>/
 * <harnessHome>/<id>/current
 * ```
 * SuperOne-signed offline `--artifact` remains under `releases/…` (`managed-release.ts`).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ManagedHarnessId } from './managed-release'
import type { ManagedRuntimeInstaller } from './types'
import {
  managedVersionDir,
  pruneManagedVersions,
  readCurrentPointer,
  resolveActiveInstallRoot,
  writeCurrentPointer,
} from './managed-layout'

/** Keep lockstep with apps/cli/scripts/pack-npm.ts CLAUDE_SDK_VERSION when possible. */
export const OFFICIAL_CLAUDE_SDK_VERSION = '0.3.238'

/**
 * Pinned Codex CLI on npm. Bump deliberately with release notes — never bare `latest`
 * in production enable (reproducible remote nodes).
 */
export const OFFICIAL_CODEX_NPM_VERSION = '0.149.0'

export const OFFICIAL_CLAUDE_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
export const OFFICIAL_CODEX_PACKAGE = '@openai/codex'

/** Codex publishes one platform-specific npm package per native runtime. */
export function codexPlatformPackageVersion(baseVersion = OFFICIAL_CODEX_NPM_VERSION): string {
  const platform = process.platform
  const arch = process.arch
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`unsupported arch for Codex: ${arch}`)
  }
  const suffix = platform === 'darwin'
    ? `darwin-${arch}`
    : platform === 'linux'
      ? `linux-${arch}`
      : platform === 'win32'
        ? `win32-${arch}`
        : null
  if (!suffix) throw new Error(`unsupported platform for Codex: ${platform}`)
  return `${baseVersion}-${suffix}`
}

function codexTargetTriple(): string | null {
  const triples: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  }
  return triples[`${process.platform}-${process.arch}`] ?? null
}

export interface OfficialInstallResult {
  harnessId: ManagedHarnessId
  command: string
  runtimeVersion: string
  source: 'official-npm'
  packageSpec: string
  installPrefix: string
}

/** Per-harness install prefix: `<home>/<id>/` (e.g. `~/.superone/harness/claude`). */
export function managedHarnessPrefix(nodeHome: string, harnessId: ManagedHarnessId): string {
  return resolve(nodeHome, harnessId)
}

/**
 * `ManagedRuntimeInstaller` backed by the host's `npm`. Requires Node/npm on
 * PATH and reachable registry.npmjs.org — appropriate for the CLI node, not for
 * the desktop app (see the tarball installer there).
 */
export function createOfficialNpmInstaller(
  runNpm?: (args: string[], cwd: string) => Promise<void>,
): ManagedRuntimeInstaller {
  return {
    async install(id, home) {
      const result = await installManagedFromOfficialNpm({
        nodeHome: home.root,
        harnessId: id,
        runNpm,
      })
      return {
        command: result.command,
        runtimeVersion: result.runtimeVersion,
        source: result.source,
        detail: {
          packageSpec: result.packageSpec,
          installPrefix: result.installPrefix,
        },
      }
    },
  }
}

/** Platform package for Claude Agent SDK native binary (optionalDependency name). */
export function claudePlatformPackageName(): string {
  const p = osPlatform()
  const a = osArch()
  if (a !== 'arm64' && a !== 'x64') {
    throw new Error(`unsupported arch for Claude Agent SDK: ${a}`)
  }
  if (p === 'darwin') return `@anthropic-ai/claude-agent-sdk-darwin-${a}`
  if (p === 'win32') return `@anthropic-ai/claude-agent-sdk-win32-${a}`
  if (p === 'linux') {
    // Prefer musl package on Alpine when detectable.
    if (isMuslLinux()) return `@anthropic-ai/claude-agent-sdk-linux-${a}-musl`
    return `@anthropic-ai/claude-agent-sdk-linux-${a}`
  }
  throw new Error(`unsupported platform for Claude Agent SDK: ${p}`)
}

function isMuslLinux(): boolean {
  try {
    if (existsSync('/etc/alpine-release')) return true
    // ldd --version prints to stderr on glibc; musl says "musl".
    // Avoid spawning if /lib/ld-musl* exists.
    const lib = readdirSync('/lib').some((n) => n.startsWith('ld-musl'))
    if (lib) return true
  } catch {
    /* ignore */
  }
  return false
}

export function officialPackageSpecs(harnessId: ManagedHarnessId): {
  specs: string[]
  runtimeVersion: string
} {
  if (harnessId === 'claude') {
    const ver =
      process.env.SUPERONE_CLAUDE_SDK_VERSION?.trim() || OFFICIAL_CLAUDE_SDK_VERSION
    const platform = claudePlatformPackageName()
    return {
      runtimeVersion: ver,
      specs: [`${OFFICIAL_CLAUDE_SDK_PACKAGE}@${ver}`, `${platform}@${ver}`],
    }
  }
  const ver = process.env.SUPERONE_CODEX_NPM_VERSION?.trim() || OFFICIAL_CODEX_NPM_VERSION
  return {
    runtimeVersion: ver,
    specs: [`${OFFICIAL_CODEX_PACKAGE}@${codexPlatformPackageVersion(ver)}`],
  }
}

/**
 * Resolve binary under a concrete install root (`versions/<ver>/`).
 * Does **not** follow the current pointer — pass an already-resolved root.
 */
export function resolveOfficialInstallBinaryInRoot(
  harnessId: ManagedHarnessId,
  installRoot: string,
): string | null {
  if (!installRoot || !existsSync(installRoot)) return null
  if (harnessId === 'codex') {
    const triple = codexTargetTriple()
    const nativeName = process.platform === 'win32' ? 'codex.exe' : 'codex'
    const candidates = [
      join(installRoot, 'bin', 'codex'),
      join(installRoot, 'bin', 'codex.cmd'),
      join(installRoot, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      join(installRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      ...(triple ? [
        join(installRoot, 'lib', 'node_modules', '@openai', 'codex', 'vendor', triple, 'bin', nativeName),
        join(installRoot, 'node_modules', '@openai', 'codex', 'vendor', triple, 'bin', nativeName),
      ] : []),
    ]
    for (const c of candidates) {
      if (existsSync(c) && (c.endsWith('.js') || isExecutableFile(c))) return c
    }
    return null
  }

  // Claude: native binary inside platform package
  const nm = join(installRoot, 'lib', 'node_modules')
  const scoped = join(nm, '@anthropic-ai')
  try {
    if (existsSync(scoped)) {
      const names = readdirSync(scoped).filter((n) => n.startsWith('claude-agent-sdk-'))
      for (const n of names) {
        const ext = process.platform === 'win32' ? '.exe' : ''
        const bin = join(scoped, n, `claude${ext}`)
        if (existsSync(bin)) return bin
      }
    }
  } catch {
    /* ignore */
  }
  const direct = join(
    nm,
    ...claudePlatformPackageName().split('/'),
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
  if (existsSync(direct)) return direct
  return null
}

/**
 * Resolve binary for a managed harness prefix (`<home>/<id>`).
 * Walks `current` → `versions/<ver>/`.
 */
export function resolveOfficialInstallBinary(
  harnessId: ManagedHarnessId,
  prefix: string,
): string | null {
  const root = resolveActiveInstallRoot(prefix)
  if (!root) return null
  return resolveOfficialInstallBinaryInRoot(harnessId, root)
}

function isExecutableFile(path: string): boolean {
  try {
    const st = statSync(path)
    if (!st.isFile()) return false
    // On Windows .cmd / extension-less are fine if present
    if (process.platform === 'win32') return true
    return (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * npm install official packages into node-local prefix and return the binary path.
 */
export async function installManagedFromOfficialNpm(opts: {
  nodeHome: string
  harnessId: ManagedHarnessId
  /** Injectable for tests. */
  runNpm?: (args: string[], cwd: string) => Promise<void>
}): Promise<OfficialInstallResult> {
  const { specs, runtimeVersion } = officialPackageSpecs(opts.harnessId)
  const prefix = managedHarnessPrefix(opts.nodeHome, opts.harnessId)
  mkdirSync(prefix, { recursive: true })

  const versionDir = managedVersionDir(prefix, runtimeVersion)
  const previous = readCurrentPointer(prefix)?.runtimeVersion ?? null

  // Fast path: this pin already installed under versions/<pin>
  const versionBin = resolveOfficialInstallBinaryInRoot(opts.harnessId, versionDir)
  if (versionBin) {
    writeCurrentPointer(prefix, runtimeVersion, { installRoot: versionDir })
    return {
      harnessId: opts.harnessId,
      command: versionBin,
      runtimeVersion: readInstalledVersion(versionDir, opts.harnessId) ?? runtimeVersion,
      source: 'official-npm',
      packageSpec: specs.join(' '),
      installPrefix: versionDir,
    }
  }

  const activeRoot = resolveActiveInstallRoot(prefix)
  if (activeRoot) {
    const activeBin = resolveOfficialInstallBinaryInRoot(opts.harnessId, activeRoot)
    const activeVer = readInstalledVersion(activeRoot, opts.harnessId)
    if (activeBin && activeVer === runtimeVersion) {
      writeCurrentPointer(prefix, runtimeVersion, { installRoot: activeRoot })
      return {
        harnessId: opts.harnessId,
        command: activeBin,
        runtimeVersion,
        source: 'official-npm',
        packageSpec: specs.join(' '),
        installPrefix: activeRoot,
      }
    }
  }

  mkdirSync(versionDir, { recursive: true })
  const runNpm = opts.runNpm ?? defaultRunNpm
  // Prefer --omit=dev; no global -g so we never need root.
  await runNpm(
    ['install', '--prefix', versionDir, '--omit=dev', '--no-fund', '--no-audit', ...specs],
    versionDir,
  )

  const command = resolveOfficialInstallBinaryInRoot(opts.harnessId, versionDir)
  if (!command) {
    throw new Error(
      `official npm install of ${specs.join(' ')} succeeded but binary was not found under ${versionDir}`,
    )
  }

  writeFileSync(
    join(versionDir, 'install-meta.json'),
    JSON.stringify(
      {
        harnessId: opts.harnessId,
        runtimeVersion,
        packageSpec: specs.join(' '),
        source: 'official-npm',
        installedAt: Date.now(),
      },
      null,
      2,
    ),
  )
  writeCurrentPointer(prefix, runtimeVersion, { installRoot: versionDir })
  const keep = [runtimeVersion, previous].filter((v): v is string => typeof v === 'string' && v.length > 0)
  pruneManagedVersions(prefix, keep)

  return {
    harnessId: opts.harnessId,
    command,
    runtimeVersion: readInstalledVersion(versionDir, opts.harnessId) ?? runtimeVersion,
    source: 'official-npm',
    packageSpec: specs.join(' '),
    installPrefix: versionDir,
  }
}

function readInstalledVersion(installRoot: string, harnessId: ManagedHarnessId): string | null {
  try {
    const metaPath = join(installRoot, 'install-meta.json')
    if (existsSync(metaPath)) {
      const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as { runtimeVersion?: string }
      if (raw.runtimeVersion?.trim()) return raw.runtimeVersion.trim()
    }
  } catch {
    /* fall through */
  }
  try {
    const pkgCandidates =
      harnessId === 'claude'
        ? [join(installRoot, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json')]
        : [
            join(installRoot, 'lib', 'node_modules', '@openai', 'codex', 'package.json'),
            join(installRoot, 'node_modules', '@openai', 'codex', 'package.json'),
          ]
    const pkgPath = pkgCandidates.find((candidate) => existsSync(candidate))
    if (!pkgPath) return null
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    const version = raw.version?.trim()
    return version?.replace(/-(darwin|linux|win32)-(arm64|x64)$/, '') || null
  } catch {
    return null
  }
}

function defaultRunNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', args, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', (err) => {
      reject(
        new Error(
          `failed to spawn npm (${err.message}). Node.js/npm is required on the host for official harness install.`,
        ),
      )
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`npm install timed out after 10m: npm ${args.join(' ')}`))
    }, 10 * 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else {
        reject(
          new Error(
            `npm install failed (exit ${code}): npm ${args.join(' ')}\n${stderr.slice(-1200)}`,
          ),
        )
      }
    })
  })
}
