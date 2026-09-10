/**
 * Desktop ACP auto session-recap. Focus tracking lives in `@superone/shared/recap-focus`;
 * this module owns the process-wide singleton wired from Session.setForeground.
 */

import log from '../logger'
import {
  createRecapFocusController,
  type RecapFocusController,
  type RecapFocusControllerOptions,
} from '@superone/shared/recap-focus'

export {
  AUTO_RECAP_RETRY_INTERVAL_MS,
  AWAY_RECAP_POLL_MS,
  DEFAULT_SESSION_RECAP_THRESHOLD_SECS,
  FocusTracker,
  LOSE_DEBOUNCE_MS,
} from '@superone/shared/recap-focus'

export type { RecapFocusController as AcpRecapFocusController } from '@superone/shared/recap-focus'
export type { RequestAutoRecap } from '@superone/shared/recap-focus'

export type AcpRecapFocusInstallOptions = Pick<
  RecapFocusControllerOptions,
  'requestAutoRecap' | 'recapThresholdSecs' | 'now'
>

let installed: RecapFocusController | null = null

/** Session UI foreground changed (wired from Session.setForeground transitions). */
export function notifySessionRecapForeground(sessionId: string, visible: boolean): void {
  installed?.onSessionForeground(sessionId, visible)
}

/**
 * A recap was displayed for a session (stops auto retries for that away period).
 * `sessionId` is required at the type level. Empty/whitespace is a runtime no-op
 * (defensive for callers that only have optional SuperOne ids at the call site).
 */
export function notifySessionRecapReceived(sessionId: string): void {
  const id = sessionId.trim()
  if (!id) {
    log.debug('[acp-recap] markRecapShown skipped — empty sessionId')
    return
  }
  installed?.markRecapShown(id)
}

/** SuperOne session disposed — stop poll and drop tracker. */
export function notifySessionRecapSessionRemoved(sessionId: string): void {
  installed?.removeSession(sessionId)
}

export function getAcpRecapFocusController(): RecapFocusController | null {
  return installed
}

/**
 * Claim the shared auto-recap in-flight/backoff slot for this session.
 * Returns true when the caller may dispatch (or when no tracker is installed).
 */
export function claimAutoRecapDispatch(sessionId: string): boolean {
  const id = sessionId.trim()
  if (!id) return false
  if (!installed) return true
  return installed.getTracker(id).beginRecapRequest()
}

/** Release the shared auto-recap slot. `sent` starts the 90s retry backoff. */
export function finishAutoRecapDispatch(sessionId: string, sent: boolean): void {
  const id = sessionId.trim()
  if (!id || !installed) return
  installed.getTracker(id).endRecapRequest(sent)
}

export function installAcpRecapFocus(opts: AcpRecapFocusInstallOptions): RecapFocusController {
  installed?.dispose()

  const controller = createRecapFocusController({
    ...opts,
    onDispatch: (sessionId, reason) => {
      log.info('[acp-recap] auto recap request sid=%s reason=%s', sessionId, reason)
    },
    onError: (sessionId, err) => {
      log.debug(
        '[acp-recap] request failed sid=%s: %s',
        sessionId,
        err instanceof Error ? err.message : String(err),
      )
    },
  })

  const wrapped: RecapFocusController = {
    onSessionForeground: (sessionId, visible) => controller.onSessionForeground(sessionId, visible),
    markRecapShown(sessionId) {
      if (!sessionId) {
        log.debug('[acp-recap] markRecapShown no-op — empty sessionId')
        return
      }
      controller.markRecapShown(sessionId)
    },
    removeSession: (sessionId) => controller.removeSession(sessionId),
    getTracker: (sessionId) => controller.getTracker(sessionId),
    maybePregenerate: () => controller.maybePregenerate(),
    dispose() {
      controller.dispose()
      if (installed === wrapped) installed = null
    },
  }

  installed = wrapped
  return wrapped
}
