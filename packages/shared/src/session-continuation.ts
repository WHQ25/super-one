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

/**
 * When the session's prompt cache expires, if continuing it after that would
 * re-cache at least `settings.minContextTokens`; null when no hint applies.
 *
 * Reads the newest finished assistant turn. The TTL is the newest one a turn
 * reported, so a harness that reports none never hints. `contextTokens` is the
 * session's tracked size; when it is unknown (0) the turn's usage stands in.
 */
export function sessionCacheExpiresAt(input: {
  messages: readonly ChatMessage[]
  contextTokens?: number | null
  settings: SessionContinuationHintSettings
}): number | null {
  if (!input.settings.enabled) return null
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
  const tokens = input.contextTokens
    || (usage ? usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens : 0)
  if (tokens < input.settings.minContextTokens) return null
  return completedAt + CACHE_TTL_MS[ttl]
}

/** Threshold choices the settings screens offer, within {@link SESSION_CONTINUATION_MIN_CONTEXT_TOKENS}. */
export const SESSION_CONTINUATION_THRESHOLD_OPTIONS = [100_000, 200_000, 300_000, 500_000, 800_000, 1_000_000] as const

/** `300K`, `1M`. */
export function formatContinuationThreshold(tokens: number): string {
  return tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1_000)}K`
}
