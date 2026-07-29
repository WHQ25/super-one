import {
  CAPABILITY_REMINDER_REGEX,
  CAPABILITY_TAG_REGEX,
  isBuiltinCapabilityId,
  type BuiltinCapabilityId,
} from '@superone/shared/capability-prompt-tags'

export type UserMentionKind = 'file' | 'directory' | 'agent' | 'miniapp' | BuiltinCapabilityId

export type UserTextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: UserMentionKind; value: string; displayName?: string }

const MENTION_REGEX = /(^|\s)@(\S+)/g
const MINIAPP_TAG_REGEX = /<superone-miniapp>\s*<appname>([\s\S]*?)<\/appname>\s*<appid>([\s\S]*?)<\/appid>\s*<\/superone-miniapp>/g
const MINIAPP_REMINDER_REGEX = /\n*<superone-miniapp-reminder>[\s\S]*?<\/superone-miniapp-reminder>\n*/g

function classify(value: string): UserMentionKind {
  if (isBuiltinCapabilityId(value)) return value
  if (value.endsWith('/')) return 'directory'
  if (value.includes('/') || value.includes('.')) return 'file'
  return 'agent'
}

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
    if (!isBuiltinCapabilityId(id)) continue
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

export function parseUserMentions(text: string): UserTextSegment[] {
  if (text.length === 0) return []

  // 1. Strip agent-only reminder blocks — they're not for the user bubble.
  const withoutReminder = text
    .replace(MINIAPP_REMINDER_REGEX, '')
    .replace(CAPABILITY_REMINDER_REGEX, '')

  // 2. Extract structured tags (miniapp + built-in capabilities) and interleave with @-mentions.
  const tagMatches = [...findMiniAppTags(withoutReminder), ...findCapabilityTags(withoutReminder)]
    .sort((a, b) => a.start - b.start)

  const segments: UserTextSegment[] = []
  let cursor = 0

  const pushText = (slice: string) => {
    if (!slice) return
    // Re-parse @-mentions inside the text slice.
    const regex = new RegExp(MENTION_REGEX)
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(slice)) !== null) {
      const [, prefix, value] = match
      const atIndex = match.index + prefix.length
      if (atIndex > lastIndex) {
        segments.push({ type: 'text', text: slice.slice(lastIndex, atIndex) })
      }
      segments.push({ type: 'mention', kind: classify(value), value })
      lastIndex = atIndex + 1 + value.length
    }
    if (lastIndex < slice.length) {
      segments.push({ type: 'text', text: slice.slice(lastIndex) })
    }
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
