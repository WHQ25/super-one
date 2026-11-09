import { SESSION_CLEANUP_CONFIRM_TIMEOUT_MS } from '@superone/shared/session-cleanup'
import type { SessionCleanupConfirmSession } from '@superone/shared/agent-types'
import type {
  CleanupConfirmOutcome,
  NodeSessionRecord,
  SessionCleanupConfirmInput,
} from './types'
import { runningChildIdsFromSettleError, runningChildSettleMessage } from './settle-running'

export const SESSION_CLEANUP_MAX_DELETE = 50

export interface SessionCleanupHost {
  archiveEntries?(): Iterable<Readonly<NodeSessionRecord>>
  messageCount?(sessionId: string): number
  get(sessionId: string): NodeSessionRecord | null
  setUiFlags(sessionId: string, flags: { isSettled?: boolean }): NodeSessionRecord | Promise<NodeSessionRecord>
  remove(sessionId: string): NodeSessionRecord | null | Promise<NodeSessionRecord | null>
  requestCleanupConfirm?(input: SessionCleanupConfirmInput): Promise<CleanupConfirmOutcome>
}

export interface SessionCleanupRequest {
  action: unknown
  sessionIds: unknown
  sourceSessionId: string
  includePinned?: boolean
  maxDelete?: unknown
  signal?: AbortSignal
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.min(max, Math.floor(raw)))
}

function titleOf(row: { title: string | null }): string {
  const title = row.title?.trim()
  return title ? title : 'Untitled'
}

function confirmRow(row: NodeSessionRecord, host: SessionCleanupHost): SessionCleanupConfirmSession {
  return {
    id: row.sessionId,
    title: titleOf(row),
    harness: row.harnessId,
    acpAgentId: row.acpAgentId ?? null,
    messageCount: host.messageCount?.(row.sessionId) ?? row.transcript.length,
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.projectId ? { projectId: row.projectId } : {}),
  }
}

/**
 * Settle, unsettle, or delete sessions that live on this host.
 * Delete waits for requestCleanupConfirm. Spawn children are expanded from
 * parentSessionId (hidden and settled included). Settle only flags the
 * requested rows; setUiFlags already settles one level of spawn children.
 * A parent with a streaming spawn child is left unsettled and reported in
 * `blocked` instead of taking that child with it.
 */
export async function runSessionCleanup(
  host: SessionCleanupHost,
  input: SessionCleanupRequest,
): Promise<Record<string, unknown>> {
  const action = input.action
  if (action !== 'settle' && action !== 'unsettle' && action !== 'delete') {
    return {
      status: 'error',
      message: 'action must be settle | unsettle | delete. Discover sessions with session_list first.',
    }
  }
  const ids = Array.isArray(input.sessionIds)
    ? input.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (ids.length === 0) {
    return {
      status: 'error',
      message: 'sessionIds is required. Call session_list to find ids, then pass them here.',
    }
  }

  const archived = host.archiveEntries ? [...host.archiveEntries()] : []
  const byId = new Map(archived.map((row) => [row.sessionId, row]))
  if (!host.archiveEntries) {
    for (const id of ids) {
      const row = host.get(id)
      if (row) byId.set(id, row)
    }
  }
  const maxDelete = clampLimit(input.maxDelete, SESSION_CLEANUP_MAX_DELETE, SESSION_CLEANUP_MAX_DELETE)
  const ordered = ids.map((id) => byId.get(id)).filter((row): row is NodeSessionRecord => !!row)
  const skippedPinned: Array<{ id: string; title: string }> = []
  const skippedSelf: string[] = []
  const candidates: NodeSessionRecord[] = []
  const omittedDueToMaxDelete: string[] = []
  let capped = false
  for (const row of ordered) {
    if (row.sessionId === input.sourceSessionId) {
      skippedSelf.push(row.sessionId)
      continue
    }
    if (!input.includePinned && row.isPinned) {
      skippedPinned.push({ id: row.sessionId, title: titleOf(row) })
      continue
    }
    if (capped || candidates.length >= maxDelete) {
      capped = true
      omittedDueToMaxDelete.push(row.sessionId)
      continue
    }
    candidates.push(row)
    if (candidates.length >= maxDelete) capped = true
  }
  const skipFields = {
    skippedPinned,
    skippedSelf,
    ...(omittedDueToMaxDelete.length > 0 ? { omittedDueToMaxDelete } : {}),
  }
  if (candidates.length === 0) {
    return {
      status: 'ok',
      action,
      affected: [],
      ...skipFields,
      message: omittedDueToMaxDelete.length > 0
        ? 'No sessions processed (maxDelete cap reached before any eligible id).'
        : 'No matching sessions to process.',
    }
  }

  if (action === 'settle' || action === 'unsettle') {
    const settled = action === 'settle'
    const affected: Array<{ id: string; title: string }> = []
    const blocked: Array<{ id: string; title: string; runningChildIds: string[] }> = []
    for (const row of candidates) {
      try {
        await host.setUiFlags(row.sessionId, { isSettled: settled })
        affected.push({ id: row.sessionId, title: titleOf(row) })
      } catch (err) {
        const runningChildIds = settled ? runningChildIdsFromSettleError(err) : null
        if (!runningChildIds) throw err
        blocked.push({ id: row.sessionId, title: titleOf(row), runningChildIds })
      }
    }
    const status = blocked.length === 0 ? 'ok' : affected.length === 0 ? 'error' : 'partial'
    return {
      status,
      action,
      affected,
      ...(blocked.length > 0 ? {
        blocked,
        message: blocked.map((row) => runningChildSettleMessage(row.id, row.runningChildIds)).join(' '),
      } : {}),
      ...skipFields,
    }
  }

  const toDelete = new Set(candidates.map((row) => row.sessionId))
  if (host.archiveEntries) {
    for (const id of candidates.map((row) => row.sessionId)) {
      for (const child of archived) {
        if (child.parentSessionId !== id || child.sessionId === input.sourceSessionId) continue
        toDelete.add(child.sessionId)
      }
    }
  }
  if (!input.includePinned) {
    for (const id of [...toDelete]) {
      const row = byId.get(id) ?? host.get(id)
      if (row?.isPinned) toDelete.delete(id)
    }
  }
  const finalIds = [...toDelete]
  if (finalIds.length === 0) {
    return { status: 'ok', action: 'delete', deleted: [], message: 'Nothing left to delete after safety filters.' }
  }
  const confirmSessions = finalIds.map((id) => {
    const row = byId.get(id) ?? host.get(id)
    return row ? confirmRow(row, host) : { id, title: 'Untitled' }
  })
  const lines = confirmSessions.map((row) => `${row.title} (${row.id.slice(0, 8)})`)
  const message = `Permanently delete ${finalIds.length} session(s)?\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n…and ${lines.length - 15} more` : ''}`
  if (!host.get(input.sourceSessionId)) {
    return { status: 'error', message: 'Cannot open delete confirmation: current session host is unavailable.' }
  }
  if (!host.requestCleanupConfirm) {
    throw Object.assign(new Error('unsupported method on this environment: session.cleanup'), {
      code: 'not_found',
      details: { method: 'session.cleanup', unsupported: true },
    })
  }
  const outcome = await host.requestCleanupConfirm({
    sessionId: input.sourceSessionId,
    sessions: confirmSessions,
    message,
    finalIds,
    signal: input.signal,
  })
  if (outcome.action !== 'accept') {
    const text = outcome.reason === 'timeout'
      ? `Session cleanup confirmation timed out after ${SESSION_CLEANUP_CONFIRM_TIMEOUT_MS}ms`
      : outcome.reason === 'aborted'
        ? 'Session cleanup cancelled'
        : 'User did not approve session deletion.'
    return {
      status: outcome.action === 'cancel' ? 'cancelled' : 'rejected',
      action: 'delete',
      message: text,
    }
  }

  const labelFor = (id: string) => confirmSessions.find((row) => row.id === id)?.title ?? 'Untitled'
  const deleted: Array<{ id: string; title: string }> = []
  const failed: Array<{ id: string; title: string; error: string }> = []
  for (const id of finalIds) {
    try {
      const removed = await host.remove(id)
      if (!removed) throw new Error('session not found')
      deleted.push({ id, title: labelFor(id) })
    } catch (err) {
      failed.push({ id, title: labelFor(id), error: err instanceof Error ? err.message : String(err) })
    }
  }
  const status = failed.length === 0 ? 'ok' : deleted.length === 0 ? 'error' : 'partial'
  return {
    status,
    action: 'delete',
    deleted,
    ...(failed.length > 0 ? { failed } : {}),
    ...skipFields,
  }
}
