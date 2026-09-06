import {
  CAPABILITY_REMINDER_REGEX,
  CAPABILITY_TAG_REGEX,
  isStoredCapabilityId,
  type StoredCapabilityId,
} from './capability-prompt-tags'
import {
  AGENT_REMINDER_REGEX,
  AGENT_TAG_REGEX,
} from './agent-mention-tags'
import {
  DESKTOP_APP_REMINDER_REGEX,
  DESKTOP_APP_TAG_REGEX,
  MINIAPP_REMINDER_REGEX,
  MINIAPP_TAG_REGEX,
  PATH_REF_TAG_REGEX,
  SESSION_REMINDER_REGEX,
  SESSION_TAG_REGEX,
} from './miniapp-prompt-tags'

export type UserMentionKind =
  | 'file'
  | 'directory'
  | 'agent'
  | 'miniapp'
  | 'desktop-app'
  | 'session'
  | 'agent-profile'
  | StoredCapabilityId

export type UserTextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: UserMentionKind; value: string; displayName?: string }

// Re-export so ChatInput / callers can import wrap from the parser module.
export { wrapPathRefMention, expandPathRefTagsForAgent } from './miniapp-prompt-tags'

const PATH_REF_KINDS = new Set(['file', 'directory', 'agent'])

interface TagMatch {
  start: number
  end: number
  kind: UserMentionKind
  value: string
  displayName: string
}

function findMiniAppTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(MINIAPP_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'miniapp',
      displayName: m[1].trim(),
      value: m[2].trim(),
    })
  }
  return out
}

function findCapabilityTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(CAPABILITY_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const id = m[2].trim()
    // Legacy ids included: an old @collab bubble must still render as a chip.
    if (!isStoredCapabilityId(id)) continue
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: id,
      displayName: m[1].trim(),
      value: id,
    })
  }
  return out
}

function findDesktopAppTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(DESKTOP_APP_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'desktop-app',
      displayName: m[1].trim(),
      value: m[2].trim(),
    })
  }
  return out
}

function findSessionTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(SESSION_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'session',
      displayName: m[1].trim(),
      value: m[2].trim(),
    })
  }
  return out
}

function findAgentTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(AGENT_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'agent-profile',
      displayName: m[1].trim(),
      value: m[2].trim(),
    })
  }
  return out
}

function findPathRefTags(text: string): TagMatch[] {
  const out: TagMatch[] = []
  const re = new RegExp(PATH_REF_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].trim()
    if (!PATH_REF_KINDS.has(kind)) continue
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: kind as 'file' | 'directory' | 'agent',
      displayName: m[2].trim(),
      value: m[3].trim(),
    })
  }
  return out
}

/**
 * Parse a stored user-message string into text + chip segments.
 *
 * Chips only come from structured tags written when the user picks an item in
 * the mention popup (Tab / Enter / click). Bare `@token` typed as plain text
 * stays plain text — never re-classified into a chip.
 */
export function parseUserMentions(text: string): UserTextSegment[] {
  if (text.length === 0) return []

  // 1. Strip agent-only reminder blocks — they're not for the user bubble.
  const withoutReminder = text
    .replace(MINIAPP_REMINDER_REGEX, '')
    .replace(CAPABILITY_REMINDER_REGEX, '')
    .replace(DESKTOP_APP_REMINDER_REGEX, '')
    .replace(SESSION_REMINDER_REGEX, '')
    .replace(AGENT_REMINDER_REGEX, '')

  // 2. Extract structured tags only (popup-selected mentions).
  const tagMatches = [
    ...findMiniAppTags(withoutReminder),
    ...findCapabilityTags(withoutReminder),
    ...findDesktopAppTags(withoutReminder),
    ...findSessionTags(withoutReminder),
    ...findAgentTags(withoutReminder),
    ...findPathRefTags(withoutReminder),
  ].sort((a, b) => a.start - b.start)

  const segments: UserTextSegment[] = []
  let cursor = 0

  const pushText = (slice: string) => {
    if (!slice) return
    segments.push({ type: 'text', text: slice })
  }

  for (const m of tagMatches) {
    if (m.start < cursor) continue
    if (m.start > cursor) {
      pushText(withoutReminder.slice(cursor, m.start))
    }
    segments.push({ type: 'mention', kind: m.kind, value: m.value, displayName: m.displayName })
    cursor = m.end
  }
  if (cursor < withoutReminder.length) {
    pushText(withoutReminder.slice(cursor))
  }

  return segments
}
