import type { AgentEvent, ComputerUseAlwaysAllowApp, ComputerUseGrantPayload } from '@superone/shared/agent-types'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import { resolveAppIconDataUri } from './app-icon-resolver'
import type { ComputerUseService } from './computer-use-service'
import { ComputerUseError } from './types'

export type ComputerUseGrantDecision = 'session' | 'always' | 'deny' | 'cancel'

type SessionLike = {
  emitHostEvent?: (event: AgentEvent) => void
}

type SessionHostLike = {
  getSession(sessionId: string): SessionLike | null | undefined
}

type SettingsLike = {
  readAppSettings(): { computerUseAlwaysAllowApps?: ComputerUseAlwaysAllowApp[] }
  saveAppSettings(patch: { computerUseAlwaysAllowApps: ComputerUseAlwaysAllowApp[] }): unknown
}

/** Coalesce concurrent prompts for the same session+app. */
const inflightByKey = new Map<string, Promise<ComputerUseGrantDecision>>()

const GRANT_TIMEOUT_MS = 120_000

const pendingGrants = new HostConfirmRegistry<ComputerUseGrantDecision>({
  idPrefix: 'cugrant',
  timeoutMs: GRANT_TIMEOUT_MS,
  timeoutError: () => new ComputerUseError('NOT_GRANTED', 'Computer Use grant timed out.'),
})

/** Test-only injection to avoid electron graph in unit tests. */
let testSessionHost: SessionHostLike | null | undefined
let testSettings: SettingsLike | null | undefined

export function setComputerUseGrantDepsForTests(deps: {
  sessionHost?: SessionHostLike | null
  settings?: SettingsLike | null
} | null): void {
  if (!deps) {
    testSessionHost = undefined
    testSettings = undefined
    return
  }
  if ('sessionHost' in deps) testSessionHost = deps.sessionHost
  if ('settings' in deps) testSettings = deps.settings
}

/**
 * Resolve a parked computer-use grant from the renderer's permission response.
 * `allow` + `alwaysAllow` → always; `allow` only → session; else deny.
 */
export function resolveComputerUseGrant(
  requestId: string,
  allow: boolean,
  alwaysAllow?: boolean,
): boolean {
  if (!allow) return pendingGrants.settle(requestId, false, 'deny')
  return pendingGrants.settle(requestId, true, alwaysAllow ? 'always' : 'session')
}

export function rejectComputerUseGrant(requestId: string, _reason: string): boolean {
  return pendingGrants.settle(requestId, false, 'cancel')
}

function inflightKey(sessionId: string, bundleId: string): string {
  return `${sessionId}::${bundleId}`
}

/**
 * Ensure the target app is on the allowlist for this session.
 * If not granted (and not allow-all), prompts the user via permission_request.
 */
export async function ensureComputerUseAppGrant(options: {
  sessionId: string
  service: ComputerUseService
  app: string
  bundleId: string
  toolName: string
}): Promise<void> {
  const { sessionId, service, app, bundleId, toolName } = options
  if (!bundleId) {
    throw new ComputerUseError('NOT_GRANTED', 'Cannot grant Computer Use without a bundleId')
  }

  // Refresh always-allow from disk before checking (settings may have changed).
  await syncAlwaysAllowFromSettings(service)

  if (service.policy.isGranted(bundleId)) return

  const key = inflightKey(sessionId, bundleId)
  let promise = inflightByKey.get(key)
  if (!promise) {
    promise = requestGrantFromUser({ sessionId, app, bundleId, toolName })
      .finally(() => {
        inflightByKey.delete(key)
      })
    inflightByKey.set(key, promise)
  }

  const decision = await promise
  if (decision === 'deny' || decision === 'cancel') {
    throw new ComputerUseError(
      'NOT_GRANTED',
      decision === 'cancel'
        ? `User cancelled Computer Use access for ${app} (${bundleId}).`
        : `User denied Computer Use access for ${app} (${bundleId}).`,
      { bundleId, app, decision },
    )
  }

  // Another concurrent waiter may have already applied the grant.
  if (service.policy.isGranted(bundleId)) return

  const granted = { app, bundleId, tier: 'full' as const }
  service.policy.grantSession(granted)

  if (decision === 'always') {
    await persistAlwaysAllow(granted)
    // Propagate to this service's always map immediately.
    await syncAlwaysAllowFromSettings(service)
  }
}

async function loadSettings(): Promise<SettingsLike | null> {
  if (testSettings !== undefined) return testSettings
  try {
    return await import('../app-settings-service')
  } catch {
    return null
  }
}

async function loadSessionHost(): Promise<SessionHostLike | null> {
  if (testSessionHost !== undefined) return testSessionHost
  try {
    const { getSessionHost } = await import('../mcp/superone-mcp-server')
    return getSessionHost()
  } catch {
    return null
  }
}

async function syncAlwaysAllowFromSettings(service: ComputerUseService): Promise<void> {
  const settings = await loadSettings()
  if (!settings) return
  try {
    const apps = settings.readAppSettings().computerUseAlwaysAllowApps ?? []
    service.policy.setAlwaysAllowApps(apps)
  } catch {
    // ignore
  }
}

async function persistAlwaysAllow(app: ComputerUseAlwaysAllowApp): Promise<void> {
  const settings = await loadSettings()
  if (!settings) return
  try {
    const current = settings.readAppSettings().computerUseAlwaysAllowApps ?? []
    if (current.some((a) => a.bundleId === app.bundleId)) return
    settings.saveAppSettings({
      computerUseAlwaysAllowApps: [...current, { app: app.app, bundleId: app.bundleId }],
    })
    // Keep other live session policies in sync (settings UI reload is best-effort).
    try {
      const { syncAllComputerUseServicesFromSettings } = await import('./tools')
      syncAllComputerUseServicesFromSettings()
    } catch {
      // ignore circular/test graphs
    }
  } catch {
    // ignore
  }
}

async function requestGrantFromUser(payload: {
  sessionId: string
  app: string
  bundleId: string
  toolName: string
}): Promise<ComputerUseGrantDecision> {
  const host = await loadSessionHost()
  const session = host?.getSession(payload.sessionId) ?? null

  if (!session?.emitHostEvent) {
    throw new ComputerUseError(
      'NOT_GRANTED',
      `App ${payload.bundleId} is not allowed and no session is available to prompt the user. Add it under Settings → Computer Use → Always Allow, or re-run from a chat session.`,
      { bundleId: payload.bundleId },
    )
  }

  // Best-effort icon for first paint; renderer still resolves via IPC if missing.
  let iconDataUri: string | undefined
  try {
    iconDataUri = (await resolveAppIconDataUri(payload.bundleId)) ?? undefined
  } catch {
    iconDataUri = undefined
  }
  // Dynamic import: keep this module loadable in unit tests without electron-log.
  void import('../logger')
    .then(({ default: log }) => {
      log.info(
        '[computer-use] grant prompt icon for %s (%s): %s',
        payload.app,
        payload.bundleId,
        iconDataUri ? `attached (${iconDataUri.length} chars)` : 'missing — UI will retry via IPC',
      )
    })
    .catch(() => {
      // ignore logger load failures in tests
    })
  const grantPayload: ComputerUseGrantPayload = {
    app: payload.app,
    bundleId: payload.bundleId,
    toolName: payload.toolName,
    ...(iconDataUri ? { iconDataUri } : {}),
  }

  return pendingGrants.open(
    session,
    (requestId) => ({
      requestId,
      toolName: payload.toolName,
      toolUseId: requestId,
      input: {
        app: payload.app,
        bundleId: payload.bundleId,
      },
      allowAlwaysAllow: true,
      supportsAlwaysPersist: true,
      requestKind: 'computer_use_grant',
      serverName: 'superone',
      message: `Allow Computer Use for ${payload.app}?`,
      subtitle: payload.bundleId,
      riskLevel: 'medium',
      computerUseGrant: grantPayload,
    }),
    {
      timeoutError: () =>
        new ComputerUseError(
          'NOT_GRANTED',
          `Computer Use grant timed out for ${payload.app} (${payload.bundleId}).`,
          { bundleId: payload.bundleId },
        ),
    },
  )
}

/** Test helper — drop parked grants without resolving waiters (avoid unhandled rejections). */
export function clearPendingComputerUseGrants(): void {
  pendingGrants.clearForTests()
  inflightByKey.clear()
}
