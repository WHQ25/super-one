/**
 * Wait for the UI to stop moving before believing what it says.
 *
 * This matters far more on a phone than on a desktop: almost every iOS transition is
 * animated, so a snapshot taken the instant after a tap describes a screen that is
 * still flying into place. The agent then aims at a control that has already moved,
 * and the failure looks like a mis-click rather than what it is -- a stale snapshot.
 *
 * There is no "animations finished" signal to subscribe to, so this samples until
 * the picture repeats. A screen that never repeats (a video, a spinner, a live
 * camera) must not hang the tool, so timing out is a normal outcome and is reported
 * rather than thrown.
 */

export interface SettleOptions {
  /** Give up after this long and report the last sample as unsettled. */
  timeoutMs?: number
  /** Gap between samples. */
  intervalMs?: number
  /** How many identical samples in a row count as still. */
  stableSamples?: number
  /**
   * How two fingerprints are judged to describe the same screen. Defaults to exact
   * equality, which is right for a tree digest and wrong for a perceptual hash:
   * two captures of a still screen can differ by a bit because the scaler landed a
   * boundary on the other side of a cell, and demanding equality there means the
   * loop never agrees anything is still.
   */
  same?: (a: string, b: string) => boolean
  /** Injectable for tests; defaults to real time. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

export interface SettleResult<T> {
  value: T
  /** False when the timeout hit first — the value is the freshest one, but moving. */
  settled: boolean
  /** How many samples were taken, including the first. */
  samples: number
}

const realSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')
}

async function sleepUntilSample(
  ms: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  if (!signal) return sleep(ms)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(
      signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'),
    )
    signal.addEventListener('abort', onAbort, { once: true })
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export async function settle<T>(
  sample: () => Promise<T>,
  fingerprint: (value: T) => string,
  options: SettleOptions = {},
): Promise<SettleResult<T>> {
  const timeoutMs = options.timeoutMs ?? 3000
  const intervalMs = options.intervalMs ?? 120
  const stableSamples = Math.max(2, options.stableSamples ?? 2)
  const sleep = options.sleep ?? realSleep
  const same = options.same ?? ((a: string, b: string) => a === b)
  const now = options.now ?? Date.now
  const signal = options.signal

  const startedAt = now()
  throwIfAborted(signal)
  let value = await sample()
  throwIfAborted(signal)
  // Anchored to the first sample of the current run rather than compared with the
  // immediately previous one. With a tolerant comparator a sliding window lets the
  // screen creep arbitrarily far while every adjacent pair stays inside the
  // tolerance, so a slow scroll would be reported as settled mid-motion.
  let anchor = fingerprint(value)
  let repeats = 1
  let samples = 1

  // One sample can never prove stillness, so the first pass always compares against
  // something -- a screen that is already static settles on the second sample.
  while (repeats < stableSamples) {
    if (now() - startedAt >= timeoutMs) return { value, settled: false, samples }
    await sleepUntilSample(intervalMs, sleep, signal)
    value = await sample()
    throwIfAborted(signal)
    samples += 1
    const current = fingerprint(value)
    if (same(current, anchor)) {
      repeats += 1
    } else {
      anchor = current
      repeats = 1
    }
  }
  return { value, settled: true, samples }
}
