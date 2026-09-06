export type MentionQuery = { atPosition: number; query: string }

const PLACEHOLDER = '\uFFFC'

/** Mirror of Flutter `extractMentionQuery`: last `@` after whitespace, no space in the token. */
export function extractMentionQuery(text: string, cursorPosition: number): MentionQuery | null {
  if (cursorPosition <= 0 || cursorPosition > text.length) return null
  const before = text.slice(0, cursorPosition)
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]
    if (ch === '@') {
      if (i > 0 && !/\s/.test(before[i - 1]!)) return null
      return { atPosition: i, query: before.slice(i + 1) }
    }
    if (/\s/.test(ch!) || ch === PLACEHOLDER) return null
  }
  return null
}

export type MentionItem = {
  kind: string
  path: string
  isDirectory?: boolean
  label?: string
  description?: string
  /** Validated PNG payload supplied by the paired desktop for dynamic app identities. */
  iconPng?: string
}

const MAX_MENTION_ICON_DATA_URI_LENGTH = 256_000
function mentionIconPng(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_MENTION_ICON_DATA_URI_LENGTH) return
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  return match?.[1]
}

export function parseMentionItems(rows: unknown): MentionItem[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row): MentionItem[] => {
    if (!row || typeof row !== 'object') return []
    const value = row as Record<string, unknown>
    const path = typeof value.path === 'string' ? value.path : typeof value.name === 'string' ? value.name : ''
    if (!path) return []
    return [{ kind: typeof value.kind === 'string' ? value.kind : 'file', path,
      isDirectory: value.isDirectory === true,
      label: typeof value.label === 'string' ? value.label : undefined,
      description: typeof value.description === 'string' ? value.description : undefined,
      iconPng: mentionIconPng(value.iconDataUri) }]
  })
}

export function insertMention(text: string, query: MentionQuery, item: MentionItem): string {
  const insert = item.kind === 'dir-entry'
    ? `@${item.path}${item.isDirectory ? '/' : ' '}`
    : `@${item.path} `
  return `${text.slice(0, query.atPosition)}${insert}${text.slice(query.atPosition + 1 + query.query.length)}`
}

/** Provider refs come from the connected host, never from a locally invented
 * harness/base-id table. Older hosts simply omit this additive response field. */
export function parseAgentMentionItems(raw: unknown, query: string): MentionItem[] {
  if (!Array.isArray(raw)) return []
  const needle = query.trim().toLowerCase()
  return raw.flatMap((entry): MentionItem[] => {
    if (!entry || typeof entry !== 'object') return []
    const target = entry as Record<string, unknown>
    if (typeof target.ref !== 'string' || !target.ref.trim() || typeof target.slug !== 'string'
      || !target.slug || typeof target.displayName !== 'string' || !target.displayName) return []
    const aliases = Array.isArray(target.aliases) ? target.aliases.filter((alias): alias is string => typeof alias === 'string') : []
    if (![target.slug, target.displayName, ...aliases].some((value) => value.toLowerCase().includes(needle))) return []
    return [{ kind: 'agent-profile', path: target.ref, label: target.displayName, description: `@${target.slug}` }]
  })
}
