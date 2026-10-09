import { AsyncCoalescer } from '../async-coalescer'

/** What one upstream read produced. `rateLimitedForMs` set means a 429: keep the last value and back off. */
export interface UsageFetchOutcome<T> {
  value?: T
  error?: string
  rateLimitedForMs?: number
  /** The login after a refresh this read did, so the next read keeps this state. */
  fingerprint?: string
}

export interface UsageReading<T> {
  value: T | null
  /** Why `value` is missing or stale; absent after a successful read. */
  error?: string
}

interface KeyState<T> {
  fingerprint: string | null
  fetchedAtMs: number | null
  rateLimitedUntilMs: number
  value: T | null
  error?: string
}

/**
 * Per-account throttle shared by every usage source: one request at a time per
 * key, at most one upstream read per `minIntervalMs`, a 429 backoff that keeps
 * the last good value, and a reset whenever the login (fingerprint) changes so
 * one account never inherits another's numbers.
 */
export class UsageThrottle<T> {
  private readonly states = new Map<string, KeyState<T>>()
  private readonly requests = new AsyncCoalescer<UsageReading<T>>()

  constructor(private readonly minIntervalMs: number, private readonly defaultBackoffMs = minIntervalMs) {}

  read(key: string, fingerprint: string | null, force: boolean, fetchUsage: () => Promise<UsageFetchOutcome<T>>): Promise<UsageReading<T>> {
    return this.requests.get(key, async () => {
      let state = this.states.get(key)
      if (!state || state.fingerprint !== fingerprint) {
        state = { fingerprint, fetchedAtMs: null, rateLimitedUntilMs: 0, value: null }
        this.states.set(key, state)
      }
      const now = Date.now()
      if (now < state.rateLimitedUntilMs) return this.reading(state)
      const wasRateLimited = state.rateLimitedUntilMs > 0
      state.rateLimitedUntilMs = 0
      if (!force && !wasRateLimited && state.fetchedAtMs !== null && now - state.fetchedAtMs < this.minIntervalMs) return this.reading(state)
      state.fetchedAtMs = now
      let outcome: UsageFetchOutcome<T>
      try {
        outcome = await fetchUsage()
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message : String(error) }
      }
      if (outcome.fingerprint) state.fingerprint = outcome.fingerprint
      if (outcome.rateLimitedForMs !== undefined) {
        state.rateLimitedUntilMs = now + (outcome.rateLimitedForMs || this.defaultBackoffMs)
        state.error = 'Rate limited; showing the last reading.'
      } else if (outcome.value !== undefined) {
        state.value = outcome.value
        state.error = undefined
      } else {
        state.error = outcome.error ?? 'Usage request failed.'
      }
      return this.reading(state)
    })
  }

  private reading(state: KeyState<T>): UsageReading<T> {
    return { value: state.value, ...(state.error ? { error: state.error } : {}) }
  }
}
