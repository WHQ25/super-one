import type { SessionRef } from '@superone/shared/environment/refs'
import type { MobileRpcClient } from './runtime-session-rpc'
import {
  createRecapFocusController,
  type FocusTracker,
  type RecapFocusController,
} from '@superone/shared/recap-focus'

export async function requestAutoSessionRecap(
  client: Pick<MobileRpcClient, 'controlledRpc'>,
  session: SessionRef,
): Promise<boolean> {
  try {
    const result = await client.controlledRpc(session, 'session.recap', { auto: true }) as { ok?: boolean }
    return result.ok === true
  } catch {
    return false
  }
}

export type AutoRecapView = {
  sessionId: string
  projectPath: string
}

export type MobileAutoRecap = {
  /**
   * Drive per-session away/return from the open chat plus app lifecycle.
   * `appActive` is React Native `AppState === 'active'` — background and
   * inactive both count as away.
   */
  sync(view: AutoRecapView | null, appActive: boolean, eligible: boolean): void
  markRecapShown(sessionId: string): void
  removeSession(sessionId: string): void
  dispose(): void
  getTracker(sessionId: string): FocusTracker
  maybePregenerate(): void
}

/**
 * Mobile auto recap: same FocusTracker as desktop, owned by the phone.
 * Unlike desktop mosaic, the phone has one visible chat — pregenerate would
 * insert the recap into a backgrounded transcript. Request only on return.
 */
export function createMobileAutoRecap(opts: {
  requestAutoRecap: (sessionId: string, projectPath: string) => boolean | Promise<boolean>
  recapThresholdSecs?: number
  now?: () => number
}): MobileAutoRecap {
  const paths = new Map<string, string>()
  let viewingId: string | null = null

  const controller: RecapFocusController = createRecapFocusController({
    recapThresholdSecs: opts.recapThresholdSecs,
    now: opts.now,
    pregenerateWhileAway: false,
    requestAutoRecap: (sessionId) => {
      const projectPath = paths.get(sessionId)
      if (!projectPath) return false
      return opts.requestAutoRecap(sessionId, projectPath)
    },
  })

  const sync = (view: AutoRecapView | null, appActive: boolean, eligible: boolean): void => {
    if (view) paths.set(view.sessionId, view.projectPath)

    if (view && !eligible) {
      if (viewingId === view.sessionId) viewingId = null
      controller.removeSession(view.sessionId)
    }

    const visibleId = view && appActive && eligible ? view.sessionId : null
    if (viewingId && viewingId !== visibleId) {
      controller.onSessionForeground(viewingId, false)
    }
    if (visibleId) {
      controller.onSessionForeground(visibleId, true)
    } else if (view && eligible && !appActive) {
      controller.onSessionForeground(view.sessionId, false)
    }
    viewingId = visibleId
  }

  return {
    sync,
    markRecapShown: (sessionId) => controller.markRecapShown(sessionId),
    removeSession: (sessionId) => {
      if (viewingId === sessionId) viewingId = null
      paths.delete(sessionId)
      controller.removeSession(sessionId)
    },
    dispose: () => controller.dispose(),
    getTracker: (sessionId) => controller.getTracker(sessionId),
    maybePregenerate: () => controller.maybePregenerate(),
  }
}
