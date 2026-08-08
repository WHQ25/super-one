/**
 * Install managed harness runtimes from **official** npm packages.
 *
 * - Claude: @anthropic-ai/claude-agent-sdk + platform optional package (same family as desktop)
 * - Codex: @openai/codex
 *
 * Install root: `$NODE_HOME/managed-npm/<harnessId>/` (user-local, no sudo).
 * SuperOne-signed offline --artifact remains a separate path in managed-harness-release.ts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { ManagedHarnessId } from './managed-harness-release'

/** Keep lockstep with apps/cli/scripts/pack-npm.ts CLAUDE_SDK_VERSION when possible. */
export const OFFICIAL_CLAUDE_SDK_VERSION = '0.3.226'

/**
 * Pinned Codex CLI on npm. Bump deliberately with release notes — never bare `latest`
 * in production enable (reproducible remote nodes).
 */
export const OFFICIAL_CODEX_NPM_VERSION = '0.146.1'

export const OFFICIAL_CLAUDE_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
export const OFFICIAL_CODEX_PACKAGE = '@openai/codex'

export interface OfficialInstallResult {
  harnessId: ManagedHarnessId
  command: string
  runtimeVersion: string
  source: 'official-npm'
  packageSpec: string
  installPrefix: string
}

export function managedNpmPrefix(nodeHome: string, harnessId: ManagedHarnessId): string {
  return resolve(nodeHome, 'managed-npm', harnessId)
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
    specs: [`${OFFICIAL_CODEX_PACKAGE}@${ver}`],
  }
}

/**
 * Resolve binary after an official npm install into `prefix`.
 */
export function resolveOfficialInstallBinary(
  harnessId: ManagedHarnessId,
  prefix: string,
): string | null {
  if (harnessId === 'codex') {
    const candidates = [
      join(prefix, 'bin', 'codex'),
      join(prefix, 'bin', 'codex.cmd'),
      join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    ]
    for (const c of candidates) {
      if (existsSync(c) && (c.endsWith('.js') || isExecutableFile(c))) return c
    }
    // Node shebang launchers on Windows
    return null
  }

  // Claude: native binary inside platform package
  const nm = join(prefix, 'lib', 'node_modules')
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
  // Fallback via package name path
  const direct = join(
    nm,
    ...claudePlatformPackageName().split('/'),
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
  if (existsSync(direct)) return direct
  return null
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
  const prefix = managedNpmPrefix(opts.nodeHome, opts.harnessId)
  mkdirSync(prefix, { recursive: true })

  // Fast path: already installed
  const existing = resolveOfficialInstallBinary(opts.harnessId, prefix)
  if (existing) {
    return {
      harnessId: opts.harnessId,
      command: existing,
      runtimeVersion: readInstalledVersion(prefix, opts.harnessId) ?? runtimeVersion,
      source: 'official-npm',
      packageSpec: specs.join(' '),
      installPrefix: prefix,
    }
  }

  const runNpm = opts.runNpm ?? defaultRunNpm
  // Prefer --omit=dev; no global -g so we never need root.
  await runNpm(
    ['install', '--prefix', prefix, '--omit=dev', '--no-fund', '--no-audit', ...specs],
    prefix,
  )

  const command = resolveOfficialInstallBinary(opts.harnessId, prefix)
  if (!command) {
    throw new Error(
      `official npm install of ${specs.join(' ')} succeeded but binary was not found under ${prefix}`,
    )
  }

  return {
    harnessId: opts.harnessId,
    command,
    runtimeVersion: readInstalledVersion(prefix, opts.harnessId) ?? runtimeVersion,
    source: 'official-npm',
    packageSpec: specs.join(' '),
    installPrefix: prefix,
  }
}

function readInstalledVersion(prefix: string, harnessId: ManagedHarnessId): string | null {
  try {
    const pkgPath =
      harnessId === 'claude'
        ? join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json')
        : join(prefix, 'lib', 'node_modules', '@openai', 'codex', 'package.json')
    if (!existsSync(pkgPath)) return null
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return raw.version?.trim() || null
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
