import type { VideoTask, VideoTaskStatus } from './ark/response'

const TERMINAL: VideoTaskStatus[] = ['succeeded', 'failed', 'cancelled']

export interface PollOptions {
  intervalMs?: number
  maxIntervalMs?: number
  timeoutMs?: number
  abortSignal?: AbortSignal
  /** Injected for tests so the poller can run on a virtual clock. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULTS = {
  intervalMs: 5_000,
  maxIntervalMs: 30_000,
  timeoutMs: 15 * 60_000,
}

function isTerminal(task: VideoTask): boolean {
  return TERMINAL.includes(task.status)
}

/**
 * Poll a generation task until it reaches a terminal state.
 *
 * Shared by every hand-written video provider (ark, sora, openai-compatible relays) — they differ
 * only in how a status is fetched, not in how it is waited on. Timeout and abort resolve to a
 * terminal task rather than throwing, so callers handle one failure shape; a transport error still
 * throws, because that is a bug to surface rather than a task outcome.
 */
export async function pollUntilDone(
  check: () => Promise<VideoTask>,
  options: PollOptions = {},
): Promise<VideoTask> {
  const intervalMs = options.intervalMs ?? DEFAULTS.intervalMs
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULTS.maxIntervalMs
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const deadline = now() + timeoutMs
  let delay = intervalMs
  let last: VideoTask | undefined

  for (;;) {
    last = await check()
    if (isTerminal(last)) return last

    if (options.abortSignal?.aborted) {
      return { id: last.id, status: 'cancelled', error: 'Video generation was cancelled.' }
    }
    if (now() >= deadline) {
      return {
        id: last.id,
        status: 'failed',
        error: `Video generation timed out after ${Math.round(timeoutMs / 1000)}s while still ${last.status}.`,
      }
    }

    await sleep(delay)
    delay = Math.min(delay * 2, maxIntervalMs)
  }
}
