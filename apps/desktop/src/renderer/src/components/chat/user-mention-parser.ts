export type UserMentionKind = 'file' | 'directory' | 'agent' | 'miniapp'

export type UserTextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: UserMentionKind; value: string; displayName?: string }

const MENTION_REGEX = /(^|\s)@(\S+)/g
const MINIAPP_TAG_REGEX = /<superone-miniapp>\s*<appname>([\s\S]*?)<\/appname>\s*<appid>([\s\S]*?)<\/appid>\s*<\/superone-miniapp>/g
const MINIAPP_REMINDER_REGEX = /\n*<superone-miniapp-reminder>[\s\S]*?<\/superone-miniapp-reminder>\n*/g

function classify(value: string): UserMentionKind {
  if (value.endsWith('/')) return 'directory'
  if (value.includes('/') || value.includes('.')) return 'file'
  return 'agent'
}

interface MiniAppMatch {
  start: number
  end: number
  appId: string
  appName: string
}

function findMiniAppTags(text: string): MiniAppMatch[] {
  const out: MiniAppMatch[] = []
  const re = new RegExp(MINIAPP_TAG_REGEX)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      appName: m[1].trim(),
      appId: m[2].trim(),
    })
  }
  return out
}

export function parseUserMentions(text: string): UserTextSegment[] {
  if (text.length === 0) return []

  // 1. Strip miniapp reminder blocks entirely — they're for the agent, not the user.
  const withoutReminder = text.replace(MINIAPP_REMINDER_REGEX, '')

  // 2. Extract miniapp tag positions so we can interleave them with @-mentions.
  const miniAppMatches = findMiniAppTags(withoutReminder)

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

  for (const m of miniAppMatches) {
    if (m.start > cursor) {
      pushText(withoutReminder.slice(cursor, m.start))
    }
    segments.push({ type: 'mention', kind: 'miniapp', value: m.appId, displayName: m.appName })
    cursor = m.end
  }
  if (cursor < withoutReminder.length) {
    pushText(withoutReminder.slice(cursor))
  }

  return segments
}
