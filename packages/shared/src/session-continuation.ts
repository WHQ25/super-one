import type { ChatMessage, PromptCacheTtl } from './agent-types'

/**
 * When to offer continuing a long session whose prompt cache has expired in a
 * new session (docs/features/session-continuation.md). Desktop and mobile
 * evaluate the same facts, all read from the transcript.
 */

export interface SessionContinuationHintSettings {
  enabled: boolean
  /** Context size at or above which continuing here would re-cache enough to hint. */
  minContextTokens: number
}

export const SESSION_CONTINUATION_MIN_CONTEXT_TOKENS = { min: 100_000, max: 1_000_000 } as const

export const DEFAULT_SESSION_CONTINUATION_HINT: SessionContinuationHintSettings = {
  enabled: true,
  minContextTokens: 300_000,
}

/** Sanitize a stored or patched value; anything malformed falls back to the default field. */
export function readSessionContinuationHint(raw: unknown): SessionContinuationHintSettings {
  const value = raw && typeof raw === 'object' ? raw as Partial<Record<keyof SessionContinuationHintSettings, unknown>> : {}
  const tokens = typeof value.minContextTokens === 'number' && Number.isFinite(value.minContextTokens)
    ? Math.round(value.minContextTokens)
    : DEFAULT_SESSION_CONTINUATION_HINT.minContextTokens
  const { min, max } = SESSION_CONTINUATION_MIN_CONTEXT_TOKENS
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SESSION_CONTINUATION_HINT.enabled,
    minContextTokens: Math.min(max, Math.max(min, tokens)),
  }
}

const CACHE_TTL_MS: Record<PromptCacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/** When an idle session's prompt cache expires, and how much continuing it would re-cache. */
export interface SessionCacheExpiry {
  expiresAt: number
  contextTokens: number
}

/**
 * The prompt cache of a session whose newest assistant turn has finished;
 * null while a turn runs or when no turn reported a TTL.
 *
 * The TTL is the newest one a turn reported, so a harness that reports none
 * never hints. `contextTokens` is the session's tracked size; when it is
 * unknown (0) the finished turn's usage stands in.
 */
export function sessionCacheExpiry(input: {
  messages: readonly ChatMessage[]
  contextTokens?: number | null
}): SessionCacheExpiry | null {
  let finished: ChatMessage | undefined
  let ttl: PromptCacheTtl | undefined
  for (let index = input.messages.length - 1; index >= 0 && !ttl; index--) {
    const message = input.messages[index]!
    if (message.role !== 'assistant') continue
    if (!finished) {
      if (message.status === 'streaming' || !message.metadata?.completedAt) return null
      finished = message
    }
    ttl = message.metadata?.usage?.cacheTtl
  }
  if (!finished || !ttl) return null
  const completedAt = Date.parse(finished.metadata!.completedAt!)
  if (!Number.isFinite(completedAt)) return null
  const usage = finished.metadata?.usage
  const contextTokens = input.contextTokens
    || (usage ? usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens : 0)
  return { expiresAt: completedAt + CACHE_TTL_MS[ttl], contextTokens }
}

/** When to hint for `expiry` under `settings`: null unless enabled and the session is long enough. */
export function continuationHintAt(
  expiry: SessionCacheExpiry | null,
  settings: SessionContinuationHintSettings,
): number | null {
  if (!expiry || !settings.enabled || expiry.contextTokens < settings.minContextTokens) return null
  return expiry.expiresAt
}

/**
 * When the session's prompt cache expires, if continuing it after that would
 * re-cache at least `settings.minContextTokens`; null when no hint applies.
 */
export function sessionCacheExpiresAt(input: {
  messages: readonly ChatMessage[]
  contextTokens?: number | null
  settings: SessionContinuationHintSettings
}): number | null {
  if (!input.settings.enabled) return null
  return continuationHintAt(sessionCacheExpiry(input), input.settings)
}

/** Threshold choices the settings screens offer, within {@link SESSION_CONTINUATION_MIN_CONTEXT_TOKENS}. */
export const SESSION_CONTINUATION_THRESHOLD_OPTIONS = [100_000, 200_000, 300_000, 500_000, 800_000, 1_000_000] as const

/** `300K`, `1M`. */
export function formatContinuationThreshold(tokens: number): string {
  return tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1_000)}K`
}
