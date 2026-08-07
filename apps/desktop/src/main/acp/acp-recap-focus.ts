/**
 * Auto session-recap focus tracking (Grok TUI semantics, SuperOne session scope).
 *
 * Away is defined per SuperOne **session**, not the whole app window:
 * - Session becomes non-foreground (`setForeground` ref-count → 0) when the user
 *   switches to another chat / unmounts the tile → focus lost.
 * - Session becomes foreground again → focus gained → may request auto recap.
 *
 * Thresholds mirror Grok pager FocusTracker:
 * - recap threshold default 30s unfocused (debounce quick session switches)
 * - retry backoff 90s while shell gates auto recap (e.g. <3 min since last turn)
 * - mark shown only when a SessionRecap notification arrives for that session
 * - in-flight guard so poll/focus-gained cannot double-fire while RPC is pending
 *
 * Authoritative turn/idle gates live agent-side (handle_recap / recap_gate).
 */

import log from '../logger'

/** Minimum unfocused time before auto recap is eligible (Grok default). */
export const DEFAULT_SESSION_RECAP_THRESHOLD_SECS = 30

/** Gap between auto recap attempts while still away (Grok AUTO_RECAP_RETRY_INTERVAL). */
export const AUTO_RECAP_RETRY_INTERVAL_MS = 90_000

/** Poll interval for pre-generate while a session is away. */
export const AWAY_RECAP_POLL_MS = 20_000

/** Debounce for brief unmount/remount when switching mosaic layout. */
export const LOSE_DEBOUNCE_MS = 50

export class FocusTracker {
  private focused = true
  private lostAt: number | null = null
  private recapShownThisAway = false
  private lastAutoRecapAttemptAt: number | null = null
  /** True while an auto recap RPC is in flight for this session. */
  private inFlight = false
  /**
   * setForeground(false) scheduled but not yet applied (debounce window).
   * Used so a recap that arrives mid-debounce is not wiped by onFocusLost.
   */
  private pendingLose = false
  private markedShownDuringPendingLose = false

  constructor(
    private readonly recapThresholdMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  onFocusGained(): void {
    this.focused = true
    this.lostAt = null
    this.pendingLose = false
    this.markedShownDuringPendingLose = false
  }

  /** Mark that a debounced focus-lose has been scheduled. */
  markPendingLose(): void {
    this.pendingLose = true
    this.markedShownDuringPendingLose = false
  }

  clearPendingLose(): void {
    this.pendingLose = false
    this.markedShownDuringPendingLose = false
  }

  onFocusLost(): void {
    this.focused = false
    this.lostAt = this.now()
    // If recap landed while leave was debounced, keep shown so we do not
    // immediately re-request for the same away stretch.
    const preserveShown = this.markedShownDuringPendingLose
    this.pendingLose = false
    this.markedShownDuringPendingLose = false
    if (!preserveShown) {
      this.recapShownThisAway = false
      this.lastAutoRecapAttemptAt = null
    }
    // inFlight left alone — completion still clears it.
  }

  isFocused(): boolean {
    return this.focused
  }

  isInFlight(): boolean {
    return this.inFlight
  }

  /**
   * True when an automatic session recap request should be sent:
   * unfocused past threshold, no successful recap this away period,
   * not mid-request, and not within retry backoff after a recent attempt.
   */
  recapDue(): boolean {
    if (this.focused || this.recapShownThisAway || this.inFlight) return false
    if (
      this.lastAutoRecapAttemptAt != null
      && this.now() - this.lastAutoRecapAttemptAt < AUTO_RECAP_RETRY_INTERVAL_MS
    ) {
      return false
    }
    if (this.lostAt == null) return false
    return this.now() - this.lostAt >= this.recapThresholdMs
  }

  /** Claim the in-flight slot; returns false if already in flight. */
  beginRecapRequest(): boolean {
    if (this.inFlight) return false
    this.inFlight = true
    return true
  }

  /**
   * Release in-flight. When `sent` is true, start the 90s retry backoff.
   * Call with false when the RPC was skipped or failed before dispatch.
   */
  endRecapRequest(sent: boolean): void {
    this.inFlight = false
    if (sent) this.lastAutoRecapAttemptAt = this.now()
  }

  noteAutoRecapAttempt(): void {
    this.lastAutoRecapAttemptAt = this.now()
  }

  /** Any SessionRecap (auto or manual) stops further auto requests this away period. */
  markRecapShown(): void {
    this.recapShownThisAway = true
    if (this.pendingLose) this.markedShownDuringPendingLose = true
  }
}

/** Return true if the recap RPC was actually sent (not skipped). */
export type RequestAutoRecap = (sessionId: string) => boolean | Promise<boolean>

export interface AcpRecapFocusInstallOptions {
  /** Fire auto recap for one session that became due. */
  requestAutoRecap: RequestAutoRecap
  recapThresholdSecs?: number
  now?: () => number
}

export interface AcpRecapFocusController {
  /** Call when SuperOne session UI gains/loses foreground (ChatContent mount). */
  onSessionForeground(sessionId: string, visible: boolean): void
  /**
   * Call when a SessionRecap notification is applied.
   * sessionId is required — missing id is a no-op (never fan-out to all sessions).
   */
  markRecapShown(sessionId: string): void
  /** Drop tracker state when a SuperOne session is disposed. */
  removeSession(sessionId: string): void
  /** Test helper: tracker for a session (creates if missing). */
  getTracker(sessionId: string): FocusTracker
  /** Pre-generate check for all away sessions (tests / poll). */
  maybePregenerate(): void
  dispose(): void
}

let installed: AcpRecapFocusController | null = null

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

export function getAcpRecapFocusController(): AcpRecapFocusController | null {
  return installed
}

export function installAcpRecapFocus(opts: AcpRecapFocusInstallOptions): AcpRecapFocusController {
  installed?.dispose()

  const thresholdMs = Math.max(0, opts.recapThresholdSecs ?? DEFAULT_SESSION_RECAP_THRESHOLD_SECS) * 1000
  const now = opts.now ?? Date.now
  const trackers = new Map<string, FocusTracker>()
  /** Debounce rapid foreground flips (e.g. mosaic remount). */
  const loseTimers = new Map<string, ReturnType<typeof setTimeout>>()

  let disposed = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const trackerFor = (sessionId: string): FocusTracker => {
    let t = trackers.get(sessionId)
    if (!t) {
      t = new FocusTracker(thresholdMs, now)
      trackers.set(sessionId, t)
    }
    return t
  }

  const fireAutoRecap = (sessionId: string, reason: string, alreadyDue: boolean): void => {
    if (disposed || !alreadyDue) return
    const tracker = trackerFor(sessionId)
    // Claim in-flight before async work so concurrent poll/focus cannot double-send.
    if (!tracker.beginRecapRequest()) return
    log.info('[acp-recap] auto recap request sid=%s reason=%s', sessionId, reason)
    void Promise.resolve(opts.requestAutoRecap(sessionId))
      .then((sent) => {
        tracker.endRecapRequest(Boolean(sent))
      })
      .catch((err) => {
        tracker.endRecapRequest(false)
        log.debug(
          '[acp-recap] request failed sid=%s: %s',
          sessionId,
          err instanceof Error ? err.message : String(err),
        )
      })
  }

  const clearLoseTimer = (sessionId: string): void => {
    const t = loseTimers.get(sessionId)
    if (t) {
      clearTimeout(t)
      loseTimers.delete(sessionId)
    }
  }

  const onSessionForeground = (sessionId: string, visible: boolean): void => {
    if (disposed || !sessionId) return
    const tracker = trackerFor(sessionId)

    if (visible) {
      clearLoseTimer(sessionId)
      tracker.clearPendingLose()
      // Capture eligibility BEFORE clearing away timer (Grok FocusGained order).
      const due = tracker.recapDue()
      tracker.onFocusGained()
      maybeStopPoll()
      fireAutoRecap(sessionId, 'session-focus-gained', due)
      return
    }

    // Debounce brief unmount/remount when switching mosaic layout.
    // Timer is cleared if setForeground(true) arrives first.
    clearLoseTimer(sessionId)
    tracker.markPendingLose()
    const timer = setTimeout(() => {
      loseTimers.delete(sessionId)
      if (disposed) return
      // Session may have been removed while timer pending.
      if (!trackers.has(sessionId)) return
      tracker.onFocusLost()
      ensurePoll()
    }, LOSE_DEBOUNCE_MS)
    loseTimers.set(sessionId, timer)
  }

  const maybePregenerate = (): void => {
    if (disposed) return
    for (const [sessionId, tracker] of trackers) {
      if (tracker.isFocused()) continue
      fireAutoRecap(sessionId, 'session-away-pregenerate', tracker.recapDue())
    }
  }

  const ensurePoll = (): void => {
    if (pollTimer || disposed) return
    const anyAway = [...trackers.values()].some((t) => !t.isFocused())
    if (!anyAway) return
    pollTimer = setInterval(() => maybePregenerate(), AWAY_RECAP_POLL_MS)
    if (typeof pollTimer === 'object' && pollTimer && 'unref' in pollTimer) {
      try { (pollTimer as NodeJS.Timeout).unref() } catch { /* ignore */ }
    }
  }

  const maybeStopPoll = (): void => {
    if (!pollTimer) return
    const anyAway = [...trackers.values()].some((t) => !t.isFocused())
    if (anyAway) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  const removeSession = (sessionId: string): void => {
    clearLoseTimer(sessionId)
    trackers.delete(sessionId)
    maybeStopPoll()
  }

  const controller: AcpRecapFocusController = {
    onSessionForeground,
    markRecapShown(sessionId) {
      if (!sessionId) {
        log.debug('[acp-recap] markRecapShown no-op — empty sessionId')
        return
      }
      trackers.get(sessionId)?.markRecapShown()
    },
    removeSession,
    getTracker: trackerFor,
    maybePregenerate,
    dispose() {
      if (disposed) return
      disposed = true
      for (const t of loseTimers.values()) clearTimeout(t)
      loseTimers.clear()
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      trackers.clear()
      if (installed === controller) installed = null
    },
  }

  installed = controller
  return controller
}
