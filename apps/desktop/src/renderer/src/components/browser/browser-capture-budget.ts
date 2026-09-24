/**
 * Bounded waits for browser captures (screenshots and action recordings).
 *
 * Every await in a capture depends on frames Chromium may simply never produce
 * (a host window that is not compositing, a guest renderer that is stuck). An
 * unbounded one used to hold the tab's capture refs until the main-process
 * timeout gave up on a call the renderer was still running.
 */
export type CaptureOperation = 'Screenshot' | 'Recording'
export type CaptureStage = 'host-paint' | 'readiness' | 'selector' | 'capture' | 'encode'

const STAGE_TIMEOUT_MS: Record<CaptureStage, number> = {
  'host-paint': 2_000,
  // Per guest round trip (probe install/removal, one probe capture), not per loop.
  readiness: 2_000,
  selector: 3_000,
  capture: 3_000,
  encode: 3_000,
}

const RELOAD_HINT = 'Retry once; if it fails again the page renderer is stuck: reload the tab (browser_tabs action=reload), and reopen it if reloading does not help'

const STAGE_FAILURE: Record<Exclude<CaptureStage, 'encode'>, string> = {
  'host-paint': 'the SuperOne window did not paint a frame. Retry; if it fails again, bring the SuperOne window on screen',
  readiness: `the page did not respond or produced no frame. ${RELOAD_HINT}`,
  selector: 'the page did not answer the selector lookup, so its main thread is busy. Retry, or reload the tab',
  capture: `the page produced no frame. ${RELOAD_HINT}`,
}

const ENCODE_FAILURE: Record<CaptureOperation, string> = {
  Screenshot: 'encoding the captured image stalled. Retry, or pass a selector to capture a smaller region',
  Recording: 'encoding the video stalled. Retry the action',
}

export class CaptureStageError extends Error {
  constructor(operation: CaptureOperation, readonly stage: CaptureStage, timeoutMs: number) {
    const failure = stage === 'encode' ? ENCODE_FAILURE[operation] : STAGE_FAILURE[stage]
    super(`${operation} timed out at stage '${stage}' after ${timeoutMs}ms: ${failure}.`)
    this.name = 'CaptureStageError'
  }
}

function abortError(signal: AbortSignal, operation: CaptureOperation): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`${operation} was cancelled`)
}

/**
 * Race `work` against the stage's own limit, the capture's remaining budget and
 * cancellation. The abandoned work keeps running; callers only rely on this
 * returning so their cleanup runs.
 */
export class CaptureBudget {
  private readonly deadline: number

  constructor(
    private readonly operation: CaptureOperation,
    totalMs: number,
    private readonly signal?: AbortSignal,
  ) {
    this.deadline = Date.now() + totalMs
  }

  stage<T>(stage: CaptureStage, work: Promise<T>): Promise<T> {
    const timeoutMs = Math.max(0, Math.min(STAGE_TIMEOUT_MS[stage], this.deadline - Date.now()))
    const { operation, signal } = this
    if (signal?.aborted) return Promise.reject(abortError(signal, operation))
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => settle(() => reject(abortError(signal!, operation)))
      const timer = setTimeout(() => settle(() => reject(new CaptureStageError(operation, stage, timeoutMs))), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      function settle(finish: () => void) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        finish()
      }
      work.then((value) => settle(() => resolve(value)), (error: unknown) => settle(() => reject(error)))
    })
  }
}

/** Like a budget stage, for cleanup that must finish even after the budget is spent or cancelled. */
export function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work.then(() => {}, () => {}),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}
