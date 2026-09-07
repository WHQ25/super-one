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
  /** Host match positions, over `path`. Remap before highlighting a shorter label. */
  matchIndices?: number[]
  /** Extra names a collaborator answers to; matched but never highlighted. */
  aliases?: string[]
  /** Validated PNG payload supplied by the paired desktop for dynamic app identities. */
  iconPng?: string
  /**
   * Which root a multi-root file result came from. The host sends it only when
   * the search spanned more than one directory, and two roots can hold the same
   * relative path — without it they collide into one row.
   */
  rootPath?: string
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
      // The host already scored these; dropping them was why mobile rows had no
      // highlight while every desktop row did.
      matchIndices: Array.isArray(value.matchIndices)
        ? value.matchIndices.filter((index): index is number => Number.isInteger(index)) : undefined,
      iconPng: mentionIconPng(value.iconDataUri),
      rootPath: typeof value.rootPath === 'string' && value.rootPath ? value.rootPath : undefined }]
  })
}

export function insertMention(text: string, query: MentionQuery, item: MentionItem): string {
  // An empty directory path is the project root, and its query is a bare `@` —
  // `@/` would read as an absolute path and browse the filesystem root.
  const insert = item.kind === 'dir-entry'
    ? item.isDirectory ? `@${item.path ? `${item.path.replace(/[/\\]+$/, '')}/` : ''}` : `@${item.path} `
    : `@${item.path} `
  return `${text.slice(0, query.atPosition)}${insert}${text.slice(query.atPosition + 1 + query.query.length)}`
}

/** Provider refs come from the connected host, never from a locally invented
 * harness/base-id table. Older hosts simply omit this additive response field.
 *
 * Filtering and ranking belong to `mention-rows.ts`, which applies the same
 * slug-before-alias rule the desktop popup uses; this only parses. */
export function parseAgentMentionItems(raw: unknown): MentionItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): MentionItem[] => {
    if (!entry || typeof entry !== 'object') return []
    const target = entry as Record<string, unknown>
    if (typeof target.ref !== 'string' || !target.ref.trim() || typeof target.slug !== 'string'
      || !target.slug || typeof target.displayName !== 'string' || !target.displayName) return []
    const aliases = Array.isArray(target.aliases)
      ? target.aliases.filter((alias): alias is string => typeof alias === 'string') : []
    return [{ kind: 'agent-profile', path: target.ref, label: target.displayName, description: `@${target.slug}`, aliases }]
  })
}

/** Directories arrive as browse rows *and* as search hits (`kind: 'file'` with
 * `isDirectory`), and both have to offer the same two actions. */
export function isMentionDirectory(item: MentionItem): boolean {
  return item.isDirectory === true || item.kind === 'directory'
}

/** Descend into a directory: still editable `@path/` text, not a committed chip. */
export function directoryNavigationItem(path: string, label?: string): MentionItem {
  return { kind: 'dir-entry', path, isDirectory: true, ...(label ? { label } : {}) }
}

/** Mention the directory itself, ending the query. */
export function directoryMentionItem(item: MentionItem): MentionItem {
  return { ...item, kind: 'directory', isDirectory: true }
}
