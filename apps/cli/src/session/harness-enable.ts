/**
 * Shared harness enable/disable for CLI and admin RPC (desktop control).
 *
 * Managed (claude/codex):
 * - Preferred: offline `--artifact` matching release-manifest pin
 * - Auto (no artifact):
 *   1) runtime already on host (SDK optionalDeps / PATH / env)
 *   2) official npm pull into $NODE_HOME/managed-npm/<id>/
 *      Claude → @anthropic-ai/claude-agent-sdk + platform package
 *      Codex  → @openai/codex
 * SuperOne-signed offline --artifact remains supported for air-gapped hosts.
 */

import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  getNodeHarnessDefinition,
  isNodeHarnessId,
  type HarnessInstallationStatus,
  type NodeHarnessId,
} from '@superone/shared/environment'
import { resolveSdkClaudeBinary } from '@superone/claude'
import { resolveNodeHome } from '../config'
import type { HarnessManager } from './harness-manager'
import {
  currentCliVersion,
  describeExpectedArtifact,
  installManagedArtifactFromFile,
  isManagedHarnessId,
  loadHarnessReleaseManifest,
  type ManagedHarnessId,
} from './managed-harness-release'
import { resolveCodexBinaryPath } from './codex-turn-runner'
import { probeHarnessReadiness } from './harness-runtime-ready'
import type { ProviderStore } from '../provider/provider-store'

export interface EnableHarnessInput {
  harnessId: NodeHarnessId
  /** Offline managed artifact (absolute path). */
  artifactPath?: string
  /** External: absolute command or leave empty to search PATH. */
  command?: string
  /** OpenCode server URL alternative to command. */
  serverUrl?: string
  /** ACP-Grok argv override (replaces default agent stdio when non-empty). */
  args?: string[]
}

export async function enableHarness(
  manager: HarnessManager,
  input: EnableHarnessInput,
  providers?: ProviderStore | null,
): Promise<HarnessInstallationStatus> {
  const id = input.harnessId
  if (!isNodeHarnessId(id)) throw new Error(`unknown harnessId: ${id}`)

  let status: HarnessInstallationStatus
  if (id === 'claude' || id === 'codex') {
    status = await enableManaged(manager, id, input.artifactPath)
  } else if (id === 'opencode') {
    status = enableOpencode(manager, {
      command: input.command,
      serverUrl: input.serverUrl,
    })
  } else {
    status = enableAcpGrok(manager, {
      command: input.command,
      args: input.args ?? [],
    })
  }

  // Promote needs_auth → ready when runtime + auth already satisfied (e.g. host login).
  try {
    probeHarnessReadiness(manager, id, providers ?? null)
  } catch {
    /* probe failures leave the enable result as-is */
  }
  return manager.get(id)
}

export function disableHarness(
  manager: HarnessManager,
  harnessId: NodeHarnessId,
): HarnessInstallationStatus {
  if (!isNodeHarnessId(harnessId)) throw new Error(`unknown harnessId: ${harnessId}`)
  return manager.disable(harnessId)
}

export async function enableManaged(
  manager: HarnessManager,
  id: ManagedHarnessId,
  artifact: string | undefined,
  mode: 'enable' | 'repair' = 'enable',
): Promise<HarnessInstallationStatus> {
  const nodeHome = resolveNodeHome(undefined)
  const def = getNodeHarnessDefinition(id)

  // Offline / desktop-upload path: require release manifest + matching digest.
  if (artifact) {
    const manifest = loadHarnessReleaseManifest(nodeHome)
    if (!manifest) {
      throw new Error(
        `no release manifest found (set SUPERONE_HARNESS_MANIFEST or write ${nodeHome}/release-manifest.json)`,
      )
    }
    if (!manifest.managedHarnesses[id]) {
      throw new Error(`release manifest does not pin ${id}`)
    }
    const abs = requireRegularReadableFile(artifact)
    const installed = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: id,
      artifactPath: abs,
      manifest,
      expectedCliVersion: currentCliVersion(),
      mode,
    })
    return manager.update(id, {
      enabled: true,
      state: def.requiresAuth ? 'needs_auth' : 'ready',
      command: installed.installPath,
      runtimeVersion: installed.runtimeVersion,
      diagnosticCode: def.requiresAuth ? 'needs_auth' : null,
      diagnosticFields: def.requiresAuth
        ? { command: installed.installPath, runtimeVersion: installed.runtimeVersion }
        : null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({
        artifactPath: installed.installPath,
        source: installed.source,
        cliVersion: installed.cliVersion,
        artifactVersion: installed.artifactVersion,
        digestSha256: installed.digestSha256,
      }),
    })
  }

  // 1) Already on host (SDK optional deps / PATH / env).
  const auto = resolveManagedAutoRuntime(id)
  if (auto) {
    return manager.update(id, {
      enabled: true,
      state: def.requiresAuth ? 'needs_auth' : 'ready',
      command: auto.command,
      runtimeVersion: auto.runtimeVersion ?? null,
      diagnosticCode: def.requiresAuth ? 'needs_auth' : null,
      diagnosticFields: def.requiresAuth
        ? { command: auto.command, runtimeVersion: auto.runtimeVersion }
        : null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({
        command: auto.command,
        source: auto.source,
      }),
    })
  }

  // 2) Official npm pull (Anthropic Claude Agent SDK / OpenAI Codex).
  try {
    const { installManagedFromOfficialNpm } = await import('./managed-harness-official')
    const official = await installManagedFromOfficialNpm({ nodeHome, harnessId: id })
    return manager.update(id, {
      enabled: true,
      state: def.requiresAuth ? 'needs_auth' : 'ready',
      command: official.command,
      runtimeVersion: official.runtimeVersion,
      diagnosticCode: def.requiresAuth ? 'needs_auth' : null,
      diagnosticFields: def.requiresAuth
        ? { command: official.command, runtimeVersion: official.runtimeVersion }
        : null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({
        command: official.command,
        source: official.source,
        packageSpec: official.packageSpec,
        installPrefix: official.installPrefix,
        runtimeVersion: official.runtimeVersion,
      }),
    })
  } catch (officialErr) {
    const detail = officialErr instanceof Error ? officialErr.message : String(officialErr)
    const manifest = loadHarnessReleaseManifest(nodeHome)
    if (manifest?.managedHarnesses[id]) {
      throw new Error(
        `official install failed (${detail}); ` +
          `${describeExpectedArtifact(id, manifest)} as offline fallback`,
      )
    }
    throw new Error(
      `official install of ${id} failed: ${detail}. ` +
        `Ensure npm is on PATH and the host can reach registry.npmjs.org.`,
    )
  }
}

function resolveManagedAutoRuntime(
  id: ManagedHarnessId,
): { command: string; source: string; runtimeVersion?: string } | null {
  if (id === 'claude') {
    const sdk = resolveSdkClaudeBinary()
    if (sdk && existsSync(sdk)) {
      return { command: sdk, source: 'agent-sdk-optional' }
    }
    return null
  }
  // codex: env pin or PATH
  const fromEnv = resolveCodexBinaryPath({})
  if (fromEnv) return { command: fromEnv, source: 'env-or-catalog' }
  const fromPath = resolveExternalCommand(undefined, ['codex'])
  if (fromPath) return { command: fromPath, source: 'path' }
  return null
}

export function enableOpencode(
  manager: HarnessManager,
  opts: { command?: string; serverUrl?: string },
): HarnessInstallationStatus {
  if (opts.serverUrl) {
    const safeUrl = validateServerUrl(opts.serverUrl)
    return manager.update('opencode', {
      enabled: true,
      state: 'ready',
      command: null,
      diagnosticCode: null,
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ serverUrl: safeUrl }),
    })
  }
  const resolved = resolveExternalCommand(opts.command, ['opencode'])
  if (!resolved) {
    return manager.update('opencode', {
      enabled: true,
      state: 'missing',
      command: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({}),
    })
  }
  return manager.update('opencode', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({ command: resolved }),
  })
}

export function enableAcpGrok(
  manager: HarnessManager,
  opts: { command?: string; args: string[] },
): HarnessInstallationStatus {
  const defaultArgs = ['agent', 'stdio']
  const args = sanitizeHarnessArgs(opts.args.length > 0 ? opts.args : defaultArgs)
  const resolved = resolveExternalCommand(opts.command, ['grok'])
  if (!resolved) {
    return manager.update('acp-grok', {
      enabled: true,
      state: 'missing',
      command: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ args, usesDefaultArgs: opts.args.length === 0 }),
    })
  }
  return manager.update('acp-grok', {
    enabled: true,
    state: 'ready',
    command: resolved,
    diagnosticCode: null,
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({
      command: resolved,
      args,
      usesDefaultArgs: opts.args.length === 0,
    }),
  })
}

// --- local helpers (kept free of free-form secret logging) ---

function requireRegularReadableFile(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`path must be absolute: ${path}`)
  }
  const abs = resolve(path)
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`not a regular file: ${abs}`)
  }
  accessSync(abs, constants.R_OK)
  return realpathSync(abs)
}

function resolveExternalCommand(
  explicit: string | undefined,
  searchNames: string[],
): string | null {
  if (explicit) {
    const abs = isAbsolute(explicit) ? explicit : resolve(explicit)
    if (!existsSync(abs)) return null
    try {
      if (!statSync(abs).isFile()) return null
      accessSync(abs, constants.X_OK)
    } catch {
      return null
    }
    return realpathSync(abs)
  }
  const pathEnv = process.env.PATH || ''
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':')
  for (const name of searchNames) {
    for (const dir of dirs) {
      if (!dir) continue
      const candidate = resolve(dir, name)
      if (!existsSync(candidate)) continue
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, constants.X_OK)
        return realpathSync(candidate)
      } catch {
        /* try next */
      }
    }
  }
  return null
}

function validateServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('--server-url is not a valid URL')
  }
  if (url.username || url.password) {
    throw new Error('--server-url must not include credentials')
  }
  if (url.search && url.search !== '?') {
    throw new Error('--server-url must not include query parameters')
  }
  if (url.hash) {
    throw new Error('--server-url must not include a fragment')
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (url.protocol === 'http:') {
    if (!loopback) {
      throw new Error('--server-url http is only allowed for loopback hosts')
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('--server-url must be http(s)')
  }
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
}

function sanitizeHarnessArgs(args: string[]): string[] {
  for (const a of args) {
    if (looksLikeSecretArg(a)) {
      throw new Error('refusing to store credential-like --arg values')
    }
  }
  return args.map((a) => a.slice(0, 512)).filter((a) => a.length > 0)
}

function looksLikeSecretArg(value: string): boolean {
  if (/Bearer\s+\S+/i.test(value)) return true
  if (/\b(password|passwd|token|secret|api[_-]?key)\b\s*=/i.test(value)) return true
  if (/^[A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)\s*=/.test(value)) return true
  if (/\bsk-[A-Za-z0-9_-]{8,}\b/.test(value)) return true
  return false
}

// silence unused import when tree-shaken
void isManagedHarnessId
