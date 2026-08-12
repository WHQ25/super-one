/**
 * SuperOne MCP session tag tools: session_tag / session_tag_list
 *
 * Tags are host SQLite metadata (harness-agnostic). Not Claude JSONL.
 */

import { encode as toonEncode } from '@toon-format/toon'
import {
  SESSION_TAG_BULK_MAX,
  applySessionTagOp,
  normalizeSessionTagList,
  parseSessionTagOp,
} from '@superone/shared/session-tags'
import { getDb } from '../database'
import { getSessionTags, isSessionUserRenamed, renameSession as dbRenameSession, setSessionTags } from '../db-sessions'
import log from '../logger'
import { getProjectPathById } from '../recent-folders'
import { resolveArchiveScope, type ArchiveProjectScopeArgs } from './session-archive-tools'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import { denyMainThreadOnlyIfSubagent } from './main-thread-session-guard'

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function toonResult(value: unknown) {
  return toolResult(toonEncode(value))
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.min(max, Math.floor(raw)))
}

export interface SessionTagArgs {
  sessionId?: string
  sessionIds?: string[]
  add?: string[]
  remove?: string[]
  set?: string[]
}

export function sessionTagHandler(args: SessionTagArgs, deps: BuiltInSuperoneToolDeps) {
  const denied = denyMainThreadOnlyIfSubagent(deps.sessionId, 'session_tag')
  if (denied) return toolResult(denied, true)

  const op = parseSessionTagOp(args)
  if ('error' in op) return toolResult({ status: 'error', message: op.error }, true)

  const hasIds = Array.isArray(args.sessionIds) && args.sessionIds.length > 0
  const single = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
  if (hasIds && single) {
    return toolResult({
      status: 'error',
      message: 'Pass sessionId or sessionIds, not both.',
    }, true)
  }

  let targets: string[]
  if (hasIds) {
    if (op.kind !== 'add') {
      return toolResult({
        status: 'error',
        message: 'sessionIds only works with add (not set or remove).',
      }, true)
    }
    targets = args.sessionIds!
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim())
    if (targets.length === 0) {
      return toolResult({ status: 'error', message: 'sessionIds is empty.' }, true)
    }
    if (targets.length > SESSION_TAG_BULK_MAX) {
      return toolResult({
        status: 'error',
        message: `sessionIds is capped at ${SESSION_TAG_BULK_MAX}.`,
      }, true)
    }
  } else {
    targets = [single || deps.sessionId]
  }

  const sessions: Array<{ sessionId: string; tags: string[] }> = []
  const missing: string[] = []
  const failed: Array<{ sessionId: string; message: string }> = []

  for (const sessionId of targets) {
    const current = getSessionTags(sessionId)
    if (current == null) {
      missing.push(sessionId)
      continue
    }
    const next = applySessionTagOp(current, op)
    if ('error' in next) {
      failed.push({ sessionId, message: next.error })
      continue
    }
    if (!setSessionTags(sessionId, next)) {
      missing.push(sessionId)
      continue
    }
    sessions.push({ sessionId, tags: next })
  }

  if (sessions.length === 0 && missing.length === 0 && failed.length === 0) {
    return toolResult({ status: 'error', message: 'No sessions updated.' }, true)
  }

  if (targets.length === 1 && sessions.length === 1 && missing.length === 0 && failed.length === 0) {
    return toolResult({ status: 'ok', sessionId: sessions[0].sessionId, tags: sessions[0].tags })
  }

  return toolResult({
    status: failed.length > 0 || missing.length > 0 ? 'partial' : 'ok',
    count: sessions.length,
    sessions,
    ...(missing.length > 0 ? { missing } : {}),
    ...(failed.length > 0 ? { failed } : {}),
  })
}

export const SESSION_TAG_LIST_DEFAULT_LIMIT = 50
export const SESSION_TAG_LIST_MAX_LIMIT = 100

export interface SessionTagListArgs extends ArchiveProjectScopeArgs {
  query?: string
  includeHidden?: boolean
  limit?: number
  offset?: number
}

export function sessionTagListHandler(args: SessionTagListArgs, deps: BuiltInSuperoneToolDeps) {
  const scope = resolveArchiveScope(deps, args)
  if ('error' in scope) return scope.error

  const limit = clampLimit(args.limit, SESSION_TAG_LIST_DEFAULT_LIMIT, SESSION_TAG_LIST_MAX_LIMIT)
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : 0

  const where: string[] = []
  const params: unknown[] = []
  if (scope.mode === 'project') {
    where.push('s.project_id = ?')
    params.push(scope.projectId)
  }
  if (args.includeHidden !== true) {
    where.push('COALESCE(s.is_hidden, 0) = 0')
  }

  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  if (query) {
    where.push("LOWER(je.value) LIKE ?")
    params.push(`%${query}%`)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const db = getDb()
  const countRow = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT je.value
      FROM sessions s, json_each(COALESCE(s.tags_json, '[]')) je
      ${whereSql}
      GROUP BY je.value
    )
  `).get(...params) as { n: number }

  const rows = db.prepare(`
    SELECT je.value AS tag, COUNT(DISTINCT s.id) AS sessions
    FROM sessions s, json_each(COALESCE(s.tags_json, '[]')) je
    ${whereSql}
    GROUP BY je.value
    ORDER BY sessions DESC, tag ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{ tag: string; sessions: number }>

  const tags = rows.map((r) => ({ tag: r.tag, sessions: r.sessions }))
  return toonResult({
    ...(scope.mode === 'all'
      ? { allProjects: true }
      : { projectId: scope.projectId, allProjects: false }),
    offset,
    limit,
    count: tags.length,
    total: countRow?.n ?? tags.length,
    tags,
  })
}

export function sessionRenameHandler(args: { title: string; tags?: string[] }, deps: BuiltInSuperoneToolDeps) {
  const denied = denyMainThreadOnlyIfSubagent(deps.sessionId, 'session_rename')
  if (denied) {
    return {
      content: [{ type: 'text' as const, text: denied }],
      isError: true,
    }
  }
  const sessionId = deps.sessionId
  const trimmed = args.title.trim().replace(/^["']+|["']+$/g, '').trim()
  if (!trimmed) {
    return {
      content: [{ type: 'text' as const, text: 'Error: empty title.' }],
      isError: true,
    }
  }

  const hasTags = args.tags !== undefined
  let tagsResult: string[] | undefined
  if (hasTags) {
    const applied = applyRenameTags(sessionId, args.tags)
    if ('error' in applied) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${applied.error}` }],
        isError: true,
      }
    }
    tagsResult = applied
  }

  if (isSessionUserRenamed(sessionId)) {
    const tagNote = tagsResult
      ? ` Tags applied: ${JSON.stringify(tagsResult)}. Use session_tag for later tag edits.`
      : ''
    return {
      content: [{
        type: 'text' as const,
        text: `Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session.${tagNote}`,
      }],
      isError: true,
    }
  }
  const session = deps.sessionHost?.getSession(sessionId) ?? null
  if (session) {
    session.setTitle(trimmed, 'agent')
  } else {
    try {
      dbRenameSession(sessionId, trimmed, 'agent')
    } catch (err) {
      log.warn('[session_rename] dbRenameSession error: %s', err instanceof Error ? err.message : String(err))
    }
  }
  const tagSuffix = tagsResult ? ` Tags: ${JSON.stringify(tagsResult)}.` : ''
  return {
    content: [{ type: 'text' as const, text: `Session renamed to "${trimmed}".${tagSuffix}` }],
  }
}

/** Shared by session_rename optional tags (set). */
export function applyRenameTags(sessionId: string, rawTags: unknown): string[] | { error: string } {
  const parsed = normalizeSessionTagList(rawTags)
  if ('error' in parsed) return parsed
  const current = getSessionTags(sessionId)
  if (current == null) return { error: `Session not found: ${sessionId}` }
  if (!setSessionTags(sessionId, parsed.tags)) return { error: `Session not found: ${sessionId}` }
  return parsed.tags
}
