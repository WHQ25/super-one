import type { ChatMessage } from './agent-types'

export function parseCompactMarker(message: ChatMessage): {
  trigger: string
  preTokens: number
  postTokens?: number
  durationMs?: number
} | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const match = firstBlock.text.match(/^__compact__:(manual|auto):(\d+)(?::(\d*):(\d*))?$/)
  if (!match) return null
  return {
    trigger: match[1],
    preTokens: parseInt(match[2], 10),
    postTokens: match[3] ? parseInt(match[3], 10) : undefined,
    durationMs: match[4] ? parseInt(match[4], 10) : undefined,
  }
}

export type TurnMetaMarker =
  | { kind: 'summary'; text: string }
  | { kind: 'recap'; text: string; auto?: boolean }

export function parseTurnMetaMarker(message: ChatMessage): TurnMetaMarker | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const prefix = '__turn_meta__:'
  if (!firstBlock.text.startsWith(prefix)) return null
  try {
    const raw = JSON.parse(firstBlock.text.slice(prefix.length)) as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (!text) return null
    if (raw.kind === 'summary') return { kind: 'summary', text }
    if (raw.kind === 'recap') {
      return {
        kind: 'recap',
        text,
        ...(typeof raw.auto === 'boolean' ? { auto: raw.auto } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

export function isRedundantTurnSummaryMarker(
  meta: TurnMetaMarker,
  messages: readonly ChatMessage[],
): boolean {
  if (meta.kind !== 'summary') return false
  const text = meta.text.trim()
  if (!text) return false
  return messages.some(
    (message) => message.role === 'assistant'
      && message.providerId !== 'system'
      && (message.metadata?.turnSummary?.trim() ?? '') === text,
  )
}
