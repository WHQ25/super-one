import { mentionQueryAllowsSpaces } from '@superone/shared/session-mention-query'

export type MentionQuery = { atPosition: number; query: string }

const PLACEHOLDER = '\uFFFC'

/**
 * The open `@` query at the caret: the nearest `@` that starts a word.
 *
 * A mention is a single token, so a space normally closes the query — that is
 * what stops every word after `@src/a.ts` from being read as part of it. The
 * `@session` portal is the exemption, because its grammar *is*
 * `session <project> <title words>`; the query it produces is what decides,
 * not a flag the caller has to remember to pass.
 */
export function extractMentionQuery(text: string, cursorPosition: number): MentionQuery | null {
  if (cursorPosition <= 0 || cursorPosition > text.length) return null
  const before = text.slice(0, cursorPosition)
  let sawSpace = false
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]!
    // A chip and a line break both end the query outright: neither can be part
    // of a mention token, and a portal query does not span lines.
    if (ch === PLACEHOLDER || ch === '\n') return null
    if (ch === '@') {
      if (i > 0 && !/\s/.test(before[i - 1]!)) return null
      const query = before.slice(i + 1)
      if (sawSpace && !mentionQueryAllowsSpaces(query)) return null
      return { atPosition: i, query }
    }
    if (/\s/.test(ch)) sawSpace = true
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
  /**
   * Match positions already scored over the row's **label**. A session title
   * and a project name are matched as themselves, not as the id or token the
   * row carries, so remapping from the path would drop the highlight entirely.
   */
  labelIndices?: number[]
  /** Extra names a collaborator answers to; matched but never highlighted. */
  aliases?: string[]
  /** Validated PNG payload supplied by the paired desktop for dynamic app identities. */
  iconPng?: string
  /**
   * Replace the query with this text and keep the popup open, instead of
   * committing a mention. A folder and a `@session` scope are both waypoints,
   * not answers — and expressing that as data rather than as a branch is what
   * keeps the two editors from disagreeing about it.
   */
  navigateTo?: string
  /**
   * A short pill at the end of the row — the harness a session ran under, or a
   * project agent's model. Not prose: it has to survive being truncated to a
   * few characters beside the name.
   */
  badge?: string
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
      // A project agent's model arrives on its own field, not as a description.
      // Dropping it left every agent row claiming to inherit.
      badge: typeof value.model === 'string' && value.model ? value.model : undefined,
      rootPath: typeof value.rootPath === 'string' && value.rootPath ? value.rootPath : undefined }]
  })
}

/** Exactly what selecting this item writes into a plain-text draft. */
export function mentionInsertText(item: MentionItem): string {
  return item.navigateTo !== undefined ? `@${item.navigateTo}` : `@${item.path} `
}

export function insertMention(text: string, query: MentionQuery, item: MentionItem): string {
  return `${text.slice(0, query.atPosition)}${mentionInsertText(item)}${text.slice(query.atPosition + 1 + query.query.length)}`
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

/**
 * Descend into a directory: still editable `@path/` text, not a committed chip.
 *
 * An empty path is the project root, whose query is a bare `@` — `@/` would
 * read as an absolute path and browse the filesystem root.
 */
export function directoryNavigationItem(path: string, label?: string): MentionItem {
  const clean = path.replace(/[/\\]+$/, '')
  return {
    kind: 'dir-entry', path: clean, isDirectory: true,
    navigateTo: clean ? `${clean}/` : '',
    ...(label ? { label } : {}),
  }
}

/** Mention the directory itself, ending the query. */
export function directoryMentionItem(item: MentionItem): MentionItem {
  const { navigateTo: _navigateTo, ...rest } = item
  return { ...rest, kind: 'directory', isDirectory: true }
}
