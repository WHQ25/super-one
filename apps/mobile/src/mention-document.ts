import { wrapAgentMention } from '@superone/shared/agent-mention-tags'
import { isBuiltinCapabilityId, wrapCapabilityMention, type BuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import type { ComposerCursor } from './composer-cursor'

/** One UTF-16 position in UITextView/EditText, regardless of the visible label. */
export const MENTION_OBJECT = '\uFFFC'
export type MentionToken = {
  kind: 'file' | 'directory' | 'agent' | 'agent-profile' | 'miniapp' | 'desktop-app' | 'session' | BuiltinCapabilityId
  value: string
  displayName: string
}
export type MentionSegment = { text: string } | { mention: MentionToken }
export type MentionDocument = readonly MentionSegment[]

export function nativeMentionText(document: MentionDocument): string {
  return document.map((segment) => 'text' in segment ? segment.text : MENTION_OBJECT).join('')
}

export function nativeMentionSpans(document: MentionDocument): Array<MentionToken & { offset: number }> {
  let offset = 0
  return document.flatMap((segment) => {
    if ('text' in segment) { offset += segment.text.length; return [] }
    return [{ ...segment.mention, offset: offset++ }]
  })
}

/** Recover identities from a native snapshot after EditText/UITextView moved its
 * spans. Reject inconsistent metadata instead of silently attaching a wrong ID. */
export function documentFromNativeMentions(text: string, spans: readonly (MentionToken & { offset: number })[]): MentionSegment[] {
  const result: MentionSegment[] = []
  let position = 0
  for (const span of [...spans].sort((a, b) => a.offset - b.offset)) {
    const { offset, ...mention } = span
    if (!Number.isInteger(offset) || offset < position || text[offset] !== MENTION_OBJECT) {
      throw new RangeError('Invalid native mention span')
    }
    if (offset > position) result.push({ text: text.slice(position, offset) })
    result.push({ mention })
    position = offset + 1
  }
  if (position < text.length) result.push({ text: text.slice(position) })
  return result
}

function normalize(segments: MentionDocument): MentionSegment[] {
  const result: MentionSegment[] = []
  for (const segment of segments) {
    if ('mention' in segment) { result.push({ mention: { ...segment.mention } }); continue }
    if (!segment.text) continue
    const last = result.at(-1)
    if (last && 'text' in last) last.text += segment.text
    else result.push({ text: segment.text })
  }
  return result
}

/** Slice in native UTF-16 coordinates. A mention occupies exactly one unit. */
function slice(document: MentionDocument, start: number, end: number): MentionSegment[] {
  let offset = 0
  return document.flatMap((segment): MentionSegment[] => {
    const length = 'text' in segment ? segment.text.length : 1
    const from = Math.max(0, start - offset)
    const to = Math.min(length, end - offset)
    offset += length
    if (from >= to) return []
    return 'text' in segment ? [{ text: segment.text.slice(from, to) }] : [segment]
  })
}

export function replaceMentionRange(document: MentionDocument, range: ComposerCursor, replacement: MentionDocument): {
  document: MentionSegment[]; selection: ComposerCursor
} {
  const length = nativeMentionText(document).length
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end > length) throw new RangeError('Invalid native edit range')
  const inserted = normalize(replacement)
  // A pasted object character has no identity. Never manufacture a live chip.
  for (const segment of inserted) if ('text' in segment) segment.text = segment.text.replaceAll(MENTION_OBJECT, '\uFFFD')
  const end = range.start + nativeMentionText(inserted).length
  return {
    document: normalize([...slice(document, 0, range.start), ...inserted, ...slice(document, range.end, length)]),
    selection: { start: end, end },
  }
}

/** Plain clipboard representation; typed @words never become structured tokens. */
export function plainMentionText(document: MentionDocument): string {
  return document.map((segment) => {
    if ('text' in segment) return segment.text
    const token = segment.mention
    const value = token.kind === 'directory' ? `${token.value.replace(/\/+$/, '')}/`
      : token.kind === 'file' || token.kind === 'agent' ? token.value : token.displayName || token.value
    return `@${value}`
  }).join('')
}

/** Uses the desktop tag contract, rather than trying to recover identities from @text. */
export function serializeMentionDocument(document: MentionDocument): string {
  return document.map((segment) => {
    if ('text' in segment) return segment.text
    const { kind, value, displayName } = segment.mention
    let tag: string
    if (isBuiltinCapabilityId(kind)) tag = wrapCapabilityMention(kind, displayName)
    else if (kind === 'agent-profile') tag = wrapAgentMention(value, displayName)
    else if (kind === 'miniapp') tag = `<superone-miniapp><appname>${displayName}</appname><appid>${value}</appid></superone-miniapp>`
    else if (kind === 'desktop-app') tag = `<superone-desktop-app><name>${displayName}</name><bundleId>${value}</bundleId></superone-desktop-app>`
    else if (kind === 'session') tag = `<superone-session><title>${displayName}</title><sessionId>${value}</sessionId></superone-session>`
    else tag = wrapPathRefMention(kind, kind === 'directory' && !value.endsWith('/') ? `${value}/` : value, displayName || value)
    return ` ${tag} `
  }).join('').trim()
}
