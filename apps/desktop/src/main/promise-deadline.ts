/**
 * Bound a provider call that has no timeout of its own.
 *
 * Every harness reaches its agent through some RPC that can stop answering
 * (wedged CLI, dead HTTP server, hung SDK call). Awaiting one of those inside
 * `interrupt()` strands Stop: the IPC never resolves, the session never leaves
 * `streaming`, and the local abort fallback on the next line never runs.
 */
export const DEADLINE_EXCEEDED = Symbol('deadline-exceeded')

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof DEADLINE_EXCEEDED> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof DEADLINE_EXCEEDED>((resolve) => {
        timer = setTimeout(() => resolve(DEADLINE_EXCEEDED), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Shared budget for a provider-side cancel/interrupt round trip. */
export const INTERRUPT_CANCEL_TIMEOUT_MS = 5_000
