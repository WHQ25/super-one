import { documentFromNativeMentions, MENTION_OBJECT, type MentionSegment, type MentionToken } from './mention-document'
import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'

export type NativeMentionSpan = MentionToken & { offset: number }
export type MentionEditorCommand = {
  id: number; eventCount: number; start: number; end: number
  text: string; tokens: NativeMentionSpan[]
}
export type MentionEditorSnapshot = {
  text: string; tokens: NativeMentionSpan[]; document: MentionSegment[]
  eventCount: number; start: number; end: number; composing: boolean; rejection?: string
}

const tokenKinds = new Set(['file', 'directory', 'agent', 'agent-profile', 'miniapp', 'desktop-app', 'session'])
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid native editor snapshot')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid native editor position')
  return value
}

/** Validate the native boundary before changing the sendable draft. */
export function parseMentionEditorSnapshot(raw: unknown): MentionEditorSnapshot {
  const value = record(raw)
  if (typeof value.text !== 'string' || !Array.isArray(value.tokens) || typeof value.composing !== 'boolean') {
    throw new TypeError('Invalid native editor snapshot')
  }
  const text = value.text
  const start = integer(value.start), end = integer(value.end), eventCount = integer(value.eventCount)
  if (Math.max(start, end) > text.length) throw new RangeError('Native editor selection is outside the draft')
  const tokens = value.tokens.map((rawToken): NativeMentionSpan => {
    const token = record(rawToken)
    if (typeof token.kind !== 'string' || (!tokenKinds.has(token.kind) && !isBuiltinCapabilityId(token.kind))
      || typeof token.value !== 'string' || !token.value || typeof token.displayName !== 'string') {
      throw new TypeError('Invalid native mention identity')
    }
    return { offset: integer(token.offset), kind: token.kind as MentionToken['kind'], value: token.value, displayName: token.displayName }
  })
  const document = documentFromNativeMentions(text, tokens)
  if (document.some((segment) => 'text' in segment && segment.text.includes(MENTION_OBJECT))) {
    throw new TypeError('Native mention is missing its identity')
  }
  return { text, tokens, document, start: Math.min(start, end), end: Math.max(start, end), eventCount, composing: value.composing,
    ...(typeof value.rejection === 'string' ? { rejection: value.rejection } : {}) }
}
