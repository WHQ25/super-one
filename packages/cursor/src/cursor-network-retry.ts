import { NetworkError } from '@cursor/sdk'

/** Retries after the first failure (total attempts = retries + 1). */
export const CURSOR_NETWORK_RETRY_ATTEMPTS = 5
/** 2s / 4s / 8s / 8s / 8s — cap so later retries stay at 8s. */
export const CURSOR_NETWORK_RETRY_BASE_DELAY_MS = 2000
export const CURSOR_NETWORK_RETRY_MAX_DELAY_MS = 8000

export function isCursorRetryableNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return error.isRetryable
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  if (name !== 'NetworkError') return false
  if (!('isRetryable' in error)) return true
  return Boolean((error as { isRetryable?: unknown }).isRetryable)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function withCursorNetworkRetries<T>(
  fn: () => Promise<T>,
  opts?: {
    retries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    sleep?: (ms: number) => Promise<void>
    onRetry?: (info: { attempt: number; retries: number; delayMs: number; error: unknown }) => void
  },
): Promise<T> {
  const retries = opts?.retries ?? CURSOR_NETWORK_RETRY_ATTEMPTS
  const baseDelayMs = opts?.baseDelayMs ?? CURSOR_NETWORK_RETRY_BASE_DELAY_MS
  const maxDelayMs = opts?.maxDelayMs ?? CURSOR_NETWORK_RETRY_MAX_DELAY_MS
  const sleep = opts?.sleep ?? defaultSleep
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isCursorRetryableNetworkError(error) || attempt === retries) throw error
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      opts?.onRetry?.({ attempt: attempt + 1, retries, delayMs, error })
      await sleep(delayMs)
    }
  }
  throw lastError
}
