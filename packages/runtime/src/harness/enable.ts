/**
 * Shared harness enable/disable for every host (CLI node, admin RPC, desktop).
 *
 * Managed (claude/codex):
 * - Preferred: offline artifact matching the release-manifest pin
 * - Auto (no artifact):
 *   1) runtime already on host — `deps.resolver.autoRuntime`
 *      (SDK optionalDeps / PATH / env)
 *   2) fetch the pinned runtime — `deps.installer.install`
 *      (CLI + desktop: R2/CDN tarball, npm registry fallback)
 * SuperOne-signed offline artifacts remain supported for air-gapped hosts.
 */

import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  getNodeHarnessDefinition,
  isNodeHarnessId,
  type HarnessInstallationStatus,
  type NodeHarnessId,
} from '@superone/shared/environment'
import type { HarnessManager } from './manager'
import {
  currentCliVersion,
  describeExpectedArtifact,
  installManagedArtifactFromFile,
  isManagedHarnessId,
  loadHarnessReleaseManifest,
  type ManagedHarnessId,
} from './managed-release'
import { isCursorSdkAvailable, resolveCursorApiKeyPlain } from './cursor-availability'
import { probeHarnessReadiness } from './runtime-ready'
import type { HarnessKernelDeps } from './types'

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
  /**
   * Managed only: skip host autoRuntime (PATH/bundled) and always run the
   * installer so the pin version is aligned (desktop startup gate).
   */
  forcePin?: boolean
}

export async function enableHarness(
  manager: HarnessManager,
  input: EnableHarnessInput,
  deps: HarnessKernelDeps,
): Promise<HarnessInstallationStatus> {
  const id = input.harnessId
  if (!isNodeHarnessId(id)) throw new Error(`unknown harnessId: ${id}`)

  let status: HarnessInstallationStatus
  if (id === 'claude' || id === 'codex') {
    status = await enableManaged(manager, id, input.artifactPath, deps, 'enable', {
      forcePin: input.forcePin === true,
    })
  } else if (id === 'opencode') {
    status = enableOpencode(manager, {
      command: input.command,
      serverUrl: input.serverUrl,
    })
  } else if (id === 'cursor') {
    status = enableCursor(manager)
  } else if (id === 'dsh') {
    status = enableDeepseek(manager)
  } else {
    status = enableAcpGrok(manager, {
      command: input.command,
      args: input.args ?? [],
    })
  }

  // Promote needs_auth → ready when runtime + auth already satisfied (e.g. host login).
  try {
    probeHarnessReadiness(manager, id, { resolver: deps.resolver, auth: deps.auth })
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
  deps: HarnessKernelDeps,
  mode: 'enable' | 'repair' = 'enable',
  opts?: { forcePin?: boolean },
): Promise<HarnessInstallationStatus> {
  const nodeHome = deps.home.root
  const def = getNodeHarnessDefinition(id)
  const forcePin = opts?.forcePin === true

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

  // 1) Already on host (SDK optional deps / PATH / env) — skipped when forcePin
  // so desktop startup can require the SuperOne-managed pin only.
  if (!forcePin) {
    const auto = deps.resolver.autoRuntime(id)
    if (auto) {
      // Do not pass `runtimeVersion: null` when auto has no version — manager
      // treats null as "clear", which wiped a prior managed install's version
      // after disable → re-enable (Settings Version row disappeared).
      // Undefined leaves the existing catalog version intact.
      return manager.update(id, {
        enabled: true,
        state: def.requiresAuth ? 'needs_auth' : 'ready',
        command: auto.command,
        runtimeVersion: auto.runtimeVersion,
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
  }

  // 2) Fetch the pinned runtime (shared R2 → npm tarball installer).
  try {
    const official = await deps.installer.install(id, deps.home)
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
        ...(official.detail ?? {}),
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
    throw new Error(`official install of ${id} failed: ${detail}`)
  }
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

/**
 * Enable the Cursor Agent SDK harness.
 * Runtime is the in-process SDK (not a PATH binary / CDN pin). Auth via
 * `CURSOR_API_KEY` → ready; SDK present without key → needs_auth; else missing.
 */
export function enableCursor(manager: HarnessManager): HarnessInstallationStatus {
  const sdkOk = isCursorSdkAvailable()
  if (!sdkOk) {
    return manager.update('cursor', {
      enabled: true,
      state: 'missing',
      command: null,
      diagnosticCode: 'not_found',
      lastProbedAt: Date.now(),
      configJson: JSON.stringify({ source: 'cursor-sdk' }),
    })
  }
  const hasKey = Boolean(resolveCursorApiKeyPlain())
  const state = hasKey ? 'ready' : 'needs_auth'
  return manager.update('cursor', {
    enabled: true,
    state,
    // Non-absolute sentinel is not advertised publicly (sanitize drops it).
    command: null,
    diagnosticCode: hasKey ? null : 'needs_auth',
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({ command: 'cursor-sdk', source: 'cursor-sdk' }),
  })
}

/** Enable the embedded dsh runtime; readiness probing owns credential promotion. */
export function enableDeepseek(manager: HarnessManager): HarnessInstallationStatus {
  return manager.update('dsh', {
    enabled: true,
    state: 'needs_auth',
    command: null,
    diagnosticCode: 'needs_auth',
    lastProbedAt: Date.now(),
    configJson: JSON.stringify({ source: 'deepseek-in-process' }),
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

/**
 * Resolve an explicit path or search PATH for the first executable match.
 * Exported so hosts can reuse the same resolution rules as `enable`.
 */
export function resolveExternalCommand(
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
