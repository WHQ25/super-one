export type MentionQuery = { atPosition: number; query: string }

const PLACEHOLDER = '\uFFFC'

/** Mirror of Flutter `extractMentionQuery`: last `@` after whitespace, no space in the token. */
export function extractMentionQuery(text: string, cursorPosition: number): MentionQuery | null {
  if (cursorPosition <= 0 || cursorPosition > text.length) return null
  const before = text.slice(0, cursorPosition)
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]
    if (ch === '@') {
      if (i > 0 && before[i - 1] !== ' ' && before[i - 1] !== '\n') return null
      return { atPosition: i, query: before.slice(i + 1) }
    }
    if (ch === ' ' || ch === '\n' || ch === PLACEHOLDER) return null
  }
  return null
}

export type MentionItem = {
  kind: string
  path: string
  isDirectory?: boolean
  label?: string
}

export function insertMention(text: string, query: MentionQuery, item: MentionItem): string {
  const insert = item.kind === 'dir-entry'
    ? `@${item.path}${item.isDirectory ? '/' : ' '}`
    : `@${item.path} `
  return `${text.slice(0, query.atPosition)}${insert}${text.slice(query.atPosition + 1 + query.query.length)}`
}
