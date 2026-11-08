import type { AgentEvent } from './agent-types'

const ANTIGRAVITY_API_RETRY_CHUNK_RE =
  /^\s*(?:⚠\uFE0F?\s*)?(API error\s*\(attempt\s+(\d+)(?:\s*(?:\/|of)\s*(\d+))?\)\s*:\s*([\s\S]+?))\s*$/i

const ANTIGRAVITY_CANCELLED_TEXT_RE =
  /^\s*(?:⚠\uFE0F?\s*)?(?:The request was cancell?ed by the client\.?|Trajectory was cancell?ed\.?)\s*$/i

export function isAntigravityCancelledText(text: string): boolean {
  return ANTIGRAVITY_CANCELLED_TEXT_RE.test(text)
}

export function isAntigravityCancelledChunk(update: {
  sessionUpdate?: string
  content?: unknown
}): boolean {
  if (update.sessionUpdate !== 'agent_message_chunk') return false
  const content = update.content as { type?: unknown; text?: unknown } | undefined
  if (!content || content.type !== 'text' || typeof content.text !== 'string') return false
  return isAntigravityCancelledText(content.text)
}

export function extractAntigravityApiRetryEventFromText(
  rawText: string,
): Extract<AgentEvent, { type: 'api_retry' }> | null {
  const match = ANTIGRAVITY_API_RETRY_CHUNK_RE.exec(rawText)
  if (!match) return null
  const fullMessage = match[1]?.trim() ?? rawText.trim()
  const attempt = Number.parseInt(match[2] ?? '1', 10)
  const maxRetriesRaw = match[3] ? Number.parseInt(match[3], 10) : Number.NaN
  return {
    type: 'api_retry',
    attempt: Number.isFinite(attempt) && attempt > 0 ? attempt : 1,
    ...(Number.isFinite(maxRetriesRaw) && maxRetriesRaw > 0 ? { maxRetries: maxRetriesRaw } : {}),
    delayMs: 0,
    message: fullMessage,
    phase: 'retrying',
  }
}

export function extractAntigravityApiRetryEvent(update: {
  sessionUpdate?: string
  content?: unknown
}): Extract<AgentEvent, { type: 'api_retry' }> | null {
  if (update.sessionUpdate !== 'agent_message_chunk') return null
  const content = update.content as { type?: unknown; text?: unknown } | undefined
  if (!content || content.type !== 'text' || typeof content.text !== 'string') return null
  return extractAntigravityApiRetryEventFromText(content.text)
}

export function cleanAntigravityStepContent(rawText: string): string {
  const trimmed = rawText.trim()
  if (!trimmed) return ''
  if (isAntigravityCancelledText(trimmed) || extractAntigravityApiRetryEventFromText(trimmed)) {
    return ''
  }
  return trimmed
}
