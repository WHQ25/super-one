export type UserMentionKind = 'file' | 'directory' | 'agent'

export type UserTextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: UserMentionKind; value: string }

const MENTION_REGEX = /(^|\s)@(\S+)/g

function classify(value: string): UserMentionKind {
  if (value.endsWith('/')) return 'directory'
  if (value.includes('/') || value.includes('.')) return 'file'
  return 'agent'
}

export function parseUserMentions(text: string): UserTextSegment[] {
  if (text.length === 0) return []

  const segments: UserTextSegment[] = []
  const regex = new RegExp(MENTION_REGEX)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const [, prefix, value] = match
    const atIndex = match.index + prefix.length
    if (atIndex > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, atIndex) })
    }
    segments.push({ type: 'mention', kind: classify(value), value })
    lastIndex = atIndex + 1 + value.length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return segments
}
