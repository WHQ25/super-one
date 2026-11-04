/**
 * Harness-agnostic session tag helpers.
 * Tags live on SuperOne's own session rows — not Claude JSONL.
 */

export const SESSION_TAG_MAX_LENGTH = 32
export const SESSION_TAG_MAX_PER_SESSION = 8
export const SESSION_TAG_BULK_MAX = 50

const TAG_CHAR = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

export type SessionTagMatch = 'any' | 'all'

/**
 * Reference tags point at one tracker item (`issue-123`, `pr-456`). They are
 * high-cardinality and one-off, unlike topic labels, so `session_tag_list`
 * keeps them out of the reuse vocabulary unless asked for.
 */
export const SESSION_REF_TAG_PATTERN = /^(issue|pr)-\d+$/

export type SessionTagKind = 'label' | 'ref' | 'all'

export function isSessionRefTag(tag: string): boolean {
  return SESSION_REF_TAG_PATTERN.test(tag)
}

export function parseSessionTagKind(raw: unknown): SessionTagKind | null {
  if (raw == null || raw === '') return 'label'
  if (raw === 'label' || raw === 'ref' || raw === 'all') return raw
  return null
}

export const SESSION_TAG_LIST_DEFAULT_LIMIT = 50
export const SESSION_TAG_LIST_MAX_LIMIT = 100

export interface SessionTagCountInput {
  tags?: readonly string[] | null
  hidden?: boolean
}

/**
 * Tag counts for session_tag_list. Query matches the tag name before the
 * kind split; pagination happens after. A session counts once per tag.
 * The desktop SQL handler stays in lockstep with this order and those filters.
 */
export function pageSessionTagCounts(
  sessions: readonly SessionTagCountInput[],
  options: {
    query?: unknown
    kind?: unknown
    includeHidden?: unknown
    limit?: unknown
    offset?: unknown
  },
): { error: string } | {
  kind: SessionTagKind
  offset: number
  limit: number
  count: number
  total: number
  tags: Array<{ tag: string; sessions: number }>
} {
  const kind = parseSessionTagKind(options.kind)
  if (!kind) return { error: 'kind must be label, ref, or all.' }
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(1, Math.min(SESSION_TAG_LIST_MAX_LIMIT, Math.floor(options.limit)))
    : SESSION_TAG_LIST_DEFAULT_LIMIT
  const offset = typeof options.offset === 'number' && Number.isFinite(options.offset)
    ? Math.max(0, Math.floor(options.offset))
    : 0
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const counts = new Map<string, number>()
  for (const session of sessions) {
    if (session.hidden && options.includeHidden !== true) continue
    const seen = new Set<string>()
    for (const tag of session.tags ?? []) {
      if (typeof tag !== 'string' || seen.has(tag)) continue
      seen.add(tag)
      if (query && !tag.toLowerCase().includes(query)) continue
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  const rows = [...counts.entries()].map(([tag, sessions]) => ({ tag, sessions }))
  rows.sort((a, b) => b.sessions - a.sessions || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  const filtered = kind === 'all' ? rows : rows.filter((row) => isSessionRefTag(row.tag) === (kind === 'ref'))
  const tags = filtered.slice(offset, offset + limit)
  return { kind, offset, limit, count: tags.length, total: filtered.length, tags }
}

export type SessionTagOp =
  | { kind: 'add'; tags: string[] }
  | { kind: 'remove'; tags: string[] }
  | { kind: 'set'; tags: string[] }

export function parseTagsJson(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string')
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

/** Lowercase, trim, collapse whitespace to `-`. Returns null when the result is invalid. */
export function normalizeSessionTag(raw: string): string | null {
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, '-')
  if (!collapsed || collapsed.length > SESSION_TAG_MAX_LENGTH) return null
  if (!TAG_CHAR.test(collapsed)) return null
  return collapsed
}

export function normalizeSessionTagList(
  raw: unknown,
): { tags: string[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: 'tags must be an array of strings' }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { error: 'each tag must be a string' }
    }
    const tag = normalizeSessionTag(item)
    if (!tag) {
      return {
        error:
          `Invalid tag "${item}". Use 1–${SESSION_TAG_MAX_LENGTH} letters, numbers, or hyphens (CJK allowed).`,
      }
    }
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length > SESSION_TAG_MAX_PER_SESSION) {
      return { error: `A session can have at most ${SESSION_TAG_MAX_PER_SESSION} tags.` }
    }
  }
  return { tags: out }
}

export function parseSessionTagMatch(raw: unknown): SessionTagMatch | null {
  if (raw == null || raw === '') return 'any'
  if (raw === 'any' || raw === 'all') return raw
  return null
}

export interface SessionTagTargetArgs {
  sessionId?: unknown
  sessionIds?: unknown
  add?: unknown
  remove?: unknown
  set?: unknown
}

/**
 * Resolve one session_tag call: exactly one of add/remove/set, and either the
 * fallback session, one sessionId, or a bulk add list.
 */
export function planSessionTagUpdate(
  args: SessionTagTargetArgs,
  fallbackSessionId: string,
): { error: string } | { op: SessionTagOp; targets: string[] } {
  const op = parseSessionTagOp(args)
  if ('error' in op) return { error: op.error }
  const rawIds = args.sessionIds
  const hasIds = Array.isArray(rawIds) && rawIds.length > 0
  const single = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
  if (hasIds && single) return { error: 'Pass sessionId or sessionIds, not both.' }
  if (!hasIds) return { op, targets: [single || fallbackSessionId] }
  if (op.kind !== 'add') return { error: 'sessionIds only works with add (not set or remove).' }
  const targets = rawIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  if (targets.length === 0) return { error: 'sessionIds is empty.' }
  if (targets.length > SESSION_TAG_BULK_MAX) {
    return { error: `sessionIds is capped at ${SESSION_TAG_BULK_MAX}.` }
  }
  return { op, targets }
}

export interface SessionTagUpdateRow {
  sessionId: string
  tags: string[]
}

export interface SessionTagUpdateFailure {
  sessionId: string
  message: string
}

/** Reply body shared by the desktop archive and a remote node's session.setTags. */
export function sessionTagUpdateBody(
  targets: string[],
  sessions: SessionTagUpdateRow[],
  missing: string[],
  failed: SessionTagUpdateFailure[],
):
  | { status: 'error'; message: string }
  | { status: 'ok'; sessionId: string; tags: string[] }
  | {
      status: 'ok' | 'partial'
      count: number
      sessions: SessionTagUpdateRow[]
      missing?: string[]
      failed?: SessionTagUpdateFailure[]
    } {
  if (sessions.length === 0 && missing.length === 0 && failed.length === 0) {
    return { status: 'error', message: 'No sessions updated.' }
  }
  if (targets.length === 1 && sessions.length === 1 && missing.length === 0 && failed.length === 0) {
    return { status: 'ok', sessionId: sessions[0].sessionId, tags: sessions[0].tags }
  }
  return {
    status: failed.length > 0 || missing.length > 0 ? 'partial' : 'ok',
    count: sessions.length,
    sessions,
    ...(missing.length > 0 ? { missing } : {}),
    ...(failed.length > 0 ? { failed } : {}),
  }
}

export function parseSessionTagOp(args: {
  add?: unknown
  remove?: unknown
  set?: unknown
}): SessionTagOp | { error: string } {
  const present = [args.add !== undefined, args.remove !== undefined, args.set !== undefined]
    .filter(Boolean).length
  if (present === 0) {
    return { error: 'Pass exactly one of add, remove, or set.' }
  }
  if (present > 1) {
    return { error: 'Pass exactly one of add, remove, or set — not more than one.' }
  }
  if (args.set !== undefined) {
    const parsed = normalizeSessionTagList(args.set)
    if ('error' in parsed) return parsed
    return { kind: 'set', tags: parsed.tags }
  }
  if (args.add !== undefined) {
    const parsed = normalizeSessionTagList(args.add)
    if ('error' in parsed) return parsed
    if (parsed.tags.length === 0) return { error: 'add requires at least one tag.' }
    return { kind: 'add', tags: parsed.tags }
  }
  const parsed = normalizeSessionTagList(args.remove)
  if ('error' in parsed) return parsed
  if (parsed.tags.length === 0) return { error: 'remove requires at least one tag.' }
  return { kind: 'remove', tags: parsed.tags }
}

export function applySessionTagOp(
  current: string[],
  op: SessionTagOp,
): string[] | { error: string } {
  if (op.kind === 'set') return op.tags
  if (op.kind === 'add') {
    const seen = new Set(current)
    const next = [...current]
    for (const tag of op.tags) {
      if (seen.has(tag)) continue
      if (next.length >= SESSION_TAG_MAX_PER_SESSION) {
        return {
          error: `A session can have at most ${SESSION_TAG_MAX_PER_SESSION} tags. Remove some first.`,
        }
      }
      seen.add(tag)
      next.push(tag)
    }
    return next
  }
  const drop = new Set(op.tags)
  return current.filter((tag) => !drop.has(tag))
}

/**
 * SQL fragment + bound params that match sessions whose `tags_json` column
 * satisfies `any` (OR) or `all` (AND). Empty `tags` → no clause.
 */
export function sessionTagsMatchClause(
  columnSql: string,
  tags: string[],
  match: SessionTagMatch,
): { sql: string; params: unknown[] } {
  if (tags.length === 0) return { sql: '', params: [] }
  const placeholders = tags.map(() => '?').join(', ')
  if (match === 'any') {
    return {
      sql: `EXISTS (SELECT 1 FROM json_each(COALESCE(${columnSql}, '[]')) WHERE value IN (${placeholders}))`,
      params: tags,
    }
  }
  return {
    sql: `(SELECT COUNT(DISTINCT value) FROM json_each(COALESCE(${columnSql}, '[]')) WHERE value IN (${placeholders})) = ?`,
    params: [...tags, tags.length],
  }
}
