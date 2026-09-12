import { waitForDeviceDelay } from './types'

/**
 * Lead-in and tail on an action recording. Fixed rather than a tool parameter:
 * one second is enough for a reviewer to register the starting screen and to
 * see the settled result, and a knob the agent has to reason about is worse
 * than a clip that is always watchable.
 */
export const RECORDING_PAD_MS = 1000

export type RecordActionPorts<Reply, Capture> = {
  /** Resolves once frames are actually being captured. */
  start: () => Promise<void>
  /** Finalizes the clip; `null` when the surface produced nothing usable. */
  stop: () => Promise<Capture | null>
  /**
   * Runs the batch. `beforeEffects` is called after validation and before the
   * first touch — that is where the recorder starts and the lead-in is held.
   */
  act: (beforeEffects: () => Promise<void>) => Promise<Reply>
  signal?: AbortSignal
  /** Injectable for tests; production uses the abortable device delay. */
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>
  padMs?: number
}

export type RecordedAction<Reply, Capture> = {
  reply: Reply
  /** `undefined` when the recorder never started (the batch was rejected first). */
  capture: Capture | null | undefined
}

/**
 * Wraps one `device_act` batch in a recording: start → 1s lead-in → actions →
 * (the batch's own settle / expect wait) → 1s tail → stop.
 *
 * Two rules the shape of this function exists for. An interrupted or failed
 * batch must not leave the device-side recorder running, so any throw after
 * `start` resolved is followed by `stop`. And once the batch has *returned*,
 * the action is on the device whatever happens next — a cancel that lands in
 * the tail only shortens the clip; it never turns a `worked` into an error,
 * because the agent would then re-run an action that already happened.
 */
export async function recordAction<Reply, Capture>(
  ports: RecordActionPorts<Reply, Capture>,
): Promise<RecordedAction<Reply, Capture>> {
  const delay = ports.delay ?? waitForDeviceDelay
  const padMs = ports.padMs ?? RECORDING_PAD_MS
  let started = false
  let reply: Reply
  try {
    reply = await ports.act(async () => {
      await ports.start()
      started = true
      await delay(padMs, ports.signal)
    })
  } catch (error) {
    if (started) await ports.stop().catch(() => null)
    throw error
  }
  if (!started) return { reply, capture: undefined }
  try {
    await delay(padMs, ports.signal)
  } catch {
    // Cancelled during the tail: the batch is done and the clip has everything
    // that matters. Finalize it and hand both back.
  }
  const capture = await ports.stop()
  return { reply, capture }
}
