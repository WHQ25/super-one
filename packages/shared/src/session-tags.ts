/**
 * Harness-agnostic session tag helpers.
 * Tags live on SuperOne's own session rows — not Claude JSONL.
 */

export const SESSION_TAG_MAX_LENGTH = 32
export const SESSION_TAG_MAX_PER_SESSION = 8
export const SESSION_TAG_BULK_MAX = 50

const TAG_CHAR = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u

export type SessionTagMatch = 'any' | 'all'

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
