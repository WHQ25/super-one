import { getDb } from '../database'
import { deleteSession, hideSession } from '../db-sessions'
import log from '../logger'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import { deriveHarnessId } from '../session/session-repo'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import { toolResult, clampLimit, type ArchiveSessionRow } from './session-archive-shared'

export const SESSION_CLEANUP_MAX_DELETE = 50
const CLEANUP_CONFIRM_TIMEOUT_MS = 10 * 60_000

// --- session_cleanup ---
// Discover with session_list first; then hide/unhide immediately or delete with a host confirm dialog.

type CleanupConfirmOutcome = { action: 'accept' | 'decline' | 'cancel' }

const cleanupConfirms = new HostConfirmRegistry<CleanupConfirmOutcome>({
  idPrefix: 'sessioncleanup',
  timeoutMs: CLEANUP_CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Session cleanup confirmation timed out after ${CLEANUP_CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveSessionCleanupConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
): boolean {
  return cleanupConfirms.settle(requestId, action === 'accept', { action })
}

export function rejectSessionCleanupConfirm(requestId: string, reason: string): boolean {
  return cleanupConfirms.fail(requestId, new Error(reason))
}

export interface SessionCleanupArgs {
  action: 'hide' | 'unhide' | 'delete'
  /** Required. Prefer ids from session_list. */
  sessionIds: string[]
  includePinned?: boolean
  maxDelete?: number
}

function resolveCleanupCandidates(
  args: SessionCleanupArgs,
  selfId: string,
): {
  candidates: ArchiveSessionRow[]
  skippedPinned: ArchiveSessionRow[]
  skippedSelf: string[]
  /** Eligible ids not acted on because maxDelete cap was hit (caller order). */
  omittedDueToMaxDelete: string[]
} {
  const maxDelete = clampLimit(args.maxDelete, SESSION_CLEANUP_MAX_DELETE, SESSION_CLEANUP_MAX_DELETE)
  const ids = (Array.isArray(args.sessionIds) ? args.sessionIds : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) {
    return { candidates: [], skippedPinned: [], skippedSelf: [], omittedDueToMaxDelete: [] }
  }

  const placeholders = ids.map(() => '?').join(',')
  const db = getDb()
  // No size subquery — cleanup only needs metadata for confirm UI / pin checks.
  // Ids may span projects (global host archive).
  const rows = db.prepare(`
    SELECT s.id, s.title, s.created_at, s.is_worktree, s.is_pinned, s.is_hidden, s.git_branch, s.worktree_path,
           s.is_automation, s.provider_id, s.provider, s.acp_agent_id, s.selected_model,
           s.total_cost_usd, s.context_tokens,
           g.parent_session_id,
           COALESCE(s.last_user_message_at, s.created_at) AS last_user_msg_at,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
           NULL AS size_bytes,
           s.project_id
    FROM sessions s
    LEFT JOIN session_collaboration_grants g
      ON g.child_session_id = s.id
      AND COALESCE(g.kind, 'spawn') = 'spawn'
    WHERE s.id IN (${placeholders})
  `).all(...ids) as ArchiveSessionRow[]

  // Preserve caller order for stable UI / confirm lists
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is ArchiveSessionRow => !!r)

  const skippedPinned: ArchiveSessionRow[] = []
  const skippedSelf: string[] = []
  const candidates: ArchiveSessionRow[] = []
  const omittedDueToMaxDelete: string[] = []
  let capped = false

  for (const row of ordered) {
    if (row.id === selfId) {
      skippedSelf.push(row.id)
      continue
    }
    if (!args.includePinned && row.is_pinned) {
      skippedPinned.push(row)
      continue
    }
    if (capped || candidates.length >= maxDelete) {
      capped = true
      omittedDueToMaxDelete.push(row.id)
      continue
    }
    candidates.push(row)
    if (candidates.length >= maxDelete) capped = true
  }

  return { candidates, skippedPinned, skippedSelf, omittedDueToMaxDelete }
}

function childSessionIds(parentId: string): string[] {
  const db = getDb()
  // Spawn children only — link peers are independent sessions, not hierarchy children.
  const rows = db.prepare(`
    SELECT child_session_id AS id FROM session_collaboration_grants
    WHERE parent_session_id = ?
      AND child_session_id IS NOT NULL
      AND COALESCE(kind, 'spawn') = 'spawn'
  `).all(parentId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

export async function sessionCleanupHandler(args: SessionCleanupArgs, deps: BuiltInSuperoneToolDeps) {
  const action = args.action
  if (action !== 'hide' && action !== 'unhide' && action !== 'delete') {
    return toolResult({
      status: 'error',
      message: 'action must be hide | unhide | delete. Discover sessions with session_list first.',
    }, true)
  }

  if (!(Array.isArray(args.sessionIds) && args.sessionIds.length > 0)) {
    return toolResult({
      status: 'error',
      message: 'sessionIds is required. Call session_list to find ids, then pass them here.',
    }, true)
  }

  // Ids may come from any project (session_list with allProjects / projectId).
  const { candidates, skippedPinned, skippedSelf, omittedDueToMaxDelete } = resolveCleanupCandidates(
    args,
    deps.sessionId,
  )

  const skipFields = {
    skippedPinned: skippedPinned.map((r) => ({ id: r.id, title: r.title ?? 'Untitled' })),
    skippedSelf,
    ...(omittedDueToMaxDelete.length > 0 ? { omittedDueToMaxDelete } : {}),
  }

  if (candidates.length === 0) {
    return toolResult({
      status: 'ok',
      action,
      affected: [],
      ...skipFields,
      message: omittedDueToMaxDelete.length > 0
        ? 'No sessions processed (maxDelete cap reached before any eligible id).'
        : 'No matching sessions to process.',
    })
  }

  const ids = candidates.map((c) => c.id)

  if (action === 'hide' || action === 'unhide') {
    const hidden = action === 'hide'
    for (const id of ids) hideSession(id, hidden)
    return toolResult({
      status: 'ok',
      action,
      affected: candidates.map((r) => ({ id: r.id, title: r.title ?? 'Untitled' })),
      ...skipFields,
    })
  }

  // delete — expand collab children (still skip pinned/self)
  const toDelete = new Set(ids)
  for (const id of ids) {
    for (const child of childSessionIds(id)) {
      if (child === deps.sessionId) continue
      toDelete.add(child)
    }
  }

  if (!args.includePinned) {
    const db = getDb()
    for (const id of [...toDelete]) {
      const row = db.prepare('SELECT is_pinned FROM sessions WHERE id = ?').get(id) as { is_pinned: number } | undefined
      if (row?.is_pinned) toDelete.delete(id)
    }
  }

  const finalIds = [...toDelete]
  if (finalIds.length === 0) {
    return toolResult({ status: 'ok', action: 'delete', deleted: [], message: 'Nothing left to delete after safety filters.' })
  }

  // Build confirm rows before delete (children may not be in candidates)
  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  const confirmSessions: Array<{
    id: string
    title: string
    harness?: string
    acpAgentId?: string | null
    messageCount?: number
    createdAt?: string
    projectId?: string
  }> = []
  {
    const db = getDb()
    const getMeta = db.prepare(`
      SELECT s.id, s.title, s.created_at, s.provider_id, s.provider, s.acp_agent_id,
             (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
             s.project_id
      FROM sessions s
      WHERE s.id = ?
    `)
    for (const id of finalIds) {
      const c = candidateById.get(id)
      if (c) {
        confirmSessions.push({
          id: c.id,
          title: c.title ?? 'Untitled',
          harness: deriveHarnessId(c),
          acpAgentId: c.acp_agent_id ?? null,
          messageCount: c.message_count ?? 0,
          createdAt: c.created_at,
          projectId: c.project_id ?? undefined,
        })
        continue
      }
      const row = getMeta.get(id) as {
        id: string
        title: string | null
        created_at: string
        provider_id: string | null
        provider: string | null
        acp_agent_id: string | null
        message_count: number
        project_id: string | null
      } | undefined
      if (!row) {
        confirmSessions.push({ id, title: 'Untitled' })
        continue
      }
      confirmSessions.push({
        id: row.id,
        title: row.title?.trim() ? row.title : 'Untitled',
        harness: deriveHarnessId(row),
        acpAgentId: row.acp_agent_id ?? null,
        messageCount: row.message_count ?? 0,
        createdAt: row.created_at,
        projectId: row.project_id ?? undefined,
      })
    }
  }
  const labelFor = (id: string) =>
    confirmSessions.find((s) => s.id === id)?.title ?? 'Untitled'

  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.emitHostEvent) {
    return toolResult({
      status: 'error',
      message: 'Cannot open delete confirmation: current session host is unavailable.',
    }, true)
  }

  const confirmLines = confirmSessions.map((s) => `${s.title} (${s.id.slice(0, 8)})`)
  const message = `Permanently delete ${finalIds.length} session(s)?\n${confirmLines.slice(0, 15).join('\n')}${confirmLines.length > 15 ? `\n…and ${confirmLines.length - 15} more` : ''}`

  let outcome: CleanupConfirmOutcome
  try {
    outcome = await cleanupConfirms.open(session, (requestId) => ({
      requestId,
      toolName: 'mcp__superone__session_cleanup',
      toolUseId: requestId,
      input: { action: 'delete', sessionIds: finalIds },
      allowAlwaysAllow: false,
      serverName: 'superone',
      message,
      requestKind: 'session_cleanup_confirm',
      sessionCleanupConfirm: { sessions: confirmSessions },
    }), { signal: deps.signal, abortError: () => new Error('Session cleanup cancelled') })
  } catch (err) {
    // Match session collab: cancel/timeout are neutral outcomes (no isError), not tool failures.
    const message = err instanceof Error ? err.message : String(err)
    if (/timed out|cancelled/i.test(message)) {
      return toolResult({ status: 'cancelled', action: 'delete', message })
    }
    return toolResult({ status: 'error', message }, true)
  }

  if (outcome.action !== 'accept') {
    return toolResult({
      status: outcome.action === 'cancel' ? 'cancelled' : 'rejected',
      action: 'delete',
      message: 'User did not approve session deletion.',
    })
  }

  const deleted: Array<{ id: string; title: string }> = []
  const failed: Array<{ id: string; title: string; error: string }> = []
  for (const id of finalIds) {
    try {
      const host = deps.sessionHost
      if (!host?.disposeSession) throw new Error('Session shutdown is unavailable; deletion was not performed.')
      await host.disposeSession(id)
      deleteSession(id)
      deleted.push({ id, title: labelFor(id) })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[session_cleanup] delete failed sid=%s: %s', id, error)
      failed.push({ id, title: labelFor(id), error })
    }
  }

  const status =
    failed.length === 0
      ? 'ok'
      : deleted.length === 0
        ? 'error'
        : 'partial'

  return toolResult({
    status,
    action: 'delete',
    deleted,
    ...(failed.length > 0 ? { failed } : {}),
    ...skipFields,
  }, status === 'error')
}

// --- Test helpers ---

export function _resetSessionCleanupConfirmsForTests(): void {
  cleanupConfirms.clearForTests()
}
