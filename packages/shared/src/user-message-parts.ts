import type { ChatMessage, ImageAttachment } from './agent-types'
import { isStoredCapabilityId } from './capability-prompt-tags'
import { parseUserMentions } from './user-mention-parser'

/** A mention as a chip carries it, in the composer, a sent bubble and the clipboard. */
export type UserMention = { kind: string; value: string; displayName: string }

/** A sent user message as the composer held it: text, mentions, paste chips and attachments. */
export type UserMessagePart =
  | { text: string }
  | { mention: UserMention }
  | { paste: string }
  | { attachment: ImageAttachment }

/** Model-facing text: a one-line paste joins adjacent words; other blocks start a line. */
export function joinComposerTextSegments(texts: readonly { text: string; isPaste?: boolean }[]): string {
  const inline = (segment: { text: string; isPaste?: boolean }) => segment.isPaste && !segment.text.includes('\n')
  return texts.map((segment, index) => index === 0 ? segment.text
    : (inline(segment) || inline(texts[index - 1]!) ? ' ' : '\n') + segment.text).join('')
}

/**
 * Chips that carry a human label rather than a path: they show `displayName`,
 * never the raw value. Shared so the composer and the sent bubble cannot
 * disagree — they did, and an @agent chip rendered as `codex-base`.
 */
export function isLabelMentionKind(kind: string): boolean {
  return (
    isStoredCapabilityId(kind)
    || kind === 'desktop-app'
    || kind === 'session'
    || kind === 'git'
    || kind === 'agent-profile'
    || kind === 'mcp-resource'
  )
}

/** The label a sent chip shows: its display name, or a path's last segment. */
export function mentionLabel(kind: string, value: string, displayName?: string): string {
  if (kind === 'miniapp' || isLabelMentionKind(kind)) return displayName || value
  return value.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || value
}

/** What a mention chip copies as in plain text: a path mention keeps its path. */
export function mentionCopyText({ kind, value, displayName }: UserMention): string {
  return `@${kind === 'file' || kind === 'directory' || kind === 'agent' ? value : displayName || value}`
}

/** The stored attachment an image/document block refers to: by id when it has one, else by name. */
export function attachmentForBlock(message: Pick<ChatMessage, 'attachments'>, block: { name: string; id?: string }): ImageAttachment | undefined {
  return message.attachments?.find((item) => (block.id ? item.id === block.id : item.name === block.name))
}

/** A user message's parts in the order it was written. */
export function userMessageParts(message: ChatMessage): UserMessagePart[] {
  return message.content.flatMap((block): UserMessagePart[] => {
    if (block.type === 'image' || block.type === 'document') {
      const attachment = attachmentForBlock(message, block)
      return attachment ? [{ attachment }] : []
    }
    if (block.type !== 'text') return []
    if (block.isPaste) return [{ paste: block.text }]
    return parseUserMentions(block.text).map((seg): UserMessagePart => (seg.type === 'mention'
      ? { mention: { kind: seg.kind, value: seg.value, displayName: seg.displayName ?? seg.value } }
      : { text: seg.text }))
  })
}

const PASTE_CHIP_LINE_THRESHOLD = 10
const PASTE_CHIP_CHAR_THRESHOLD = 500
const PASTE_SUMMARY_CHARS = 40
const PASTE_EXCERPT_LINES = 10

/**
 * A message from before pastes were marked (`isPaste`) shows its long text
 * runs as a paste chip; the composer chips every paste.
 */
export function isLongPaste(text: string): boolean {
  return text.split('\n').length >= PASTE_CHIP_LINE_THRESHOLD || text.length >= PASTE_CHIP_CHAR_THRESHOLD
}

/** A paste chip's label: the text's start on one line, whitespace collapsed. */
export function pasteSummary(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > PASTE_SUMMARY_CHARS ? `${chars.slice(0, PASTE_SUMMARY_CHARS).join('')}…` : chars.join('')
}

/** The first lines of a paste, for a preview card. */
export function pasteExcerpt(text: string): string {
  const lines = text.split('\n')
  return lines.length > PASTE_EXCERPT_LINES ? `${lines.slice(0, PASTE_EXCERPT_LINES).join('\n')}\n…` : text
}
