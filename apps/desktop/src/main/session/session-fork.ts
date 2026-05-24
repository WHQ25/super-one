import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import log from '../logger'
import { gitRun } from '../git-run'
import { activateWorktree, gitErrorMessage } from '../git/worktree-ops'
import { harnessRegistry } from './harness-registry'
import { forkSessionRecord, getSessionRecord, loadSessionStateBySid, type SessionRecord } from './session-repo'
import type { ForkContext, Harness } from './types'

function forkTitle(title: string | null): string {
  const base = title?.trim() || 'Session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

/**
 * Clone the source transcript into `targetCwd` via the harness, then persist a
 * forked session record. Shared by both fork modes; `worktreePath` / `gitBranch`
 * are written onto the new record (both null for a local fork that stays in the
 * main repo). `rollback` undoes any side effect (e.g. a freshly created
 * worktree) on failure.
 */
async function persistFork(
  record: SessionRecord,
  harness: Harness,
  ctx: ForkContext,
  targetCwd: string,
  worktreePath: string | null,
  gitBranch: string | null,
  rollback: () => Promise<void>,
): Promise<SessionForkResult> {
  let newProviderSessionId: string
  try {
    newProviderSessionId = await harness.forkTranscript(
      { providerSessionId: record.providerSessionId!, projectPath: record.projectPath },
      targetCwd,
      ctx,
    )
  } catch (err) {
    await rollback()
    return { ok: false, error: `Fork transcript failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const newSessionId = randomUUID()
  try {
    forkSessionRecord({
      sourceId: record.id,
      newId: newSessionId,
      providerSessionId: newProviderSessionId,
      worktreePath,
      gitBranch,
      title: forkTitle(record.title),
      forkFromMessageId: ctx.forkFromMessageId,
    })
  } catch (err) {
    await rollback()
    return { ok: false, error: `Persisting forked session failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  return { ok: true, sessionId: newSessionId, worktreePath: worktreePath ?? undefined }
}

/**
 * Branch the conversation into a brand-new git worktree, checked out detached at
 * the source's current commit — HEAD plus every uncommitted change. That keeps
 * the forked code coherent with the forked conversation and (like Codex's
 * worktree fork) leaves no stray branch behind; the user can create one later.
 */
async function forkToNewWorktree(
  record: SessionRecord,
  harness: Harness,
  ctx: ForkContext,
  sourceCwd: string,
): Promise<SessionForkResult> {
  let worktreePath: string
  try {
    const wt = await activateWorktree(sourceCwd, { baseBranch: 'HEAD', mode: 'detach', carryLocalChanges: true })
    worktreePath = wt.path
  } catch (err) {
    return { ok: false, error: gitErrorMessage(err) }
  }

  const rollback = async () => {
    try {
      await gitRun(sourceCwd, ['worktree', 'remove', '--force', worktreePath])
    } catch (err) {
      log.warn('[session-fork] worktree cleanup after failure failed:', err)
    }
  }

  const result = await persistFork(record, harness, ctx, worktreePath, worktreePath, null, rollback)
  if (result.ok) log.info('[session-fork] forked %s → %s (worktree %s)', record.id, result.sessionId, worktreePath)
  return result
}

/**
 * Branch the conversation into an independent session that shares the source's
 * own working directory — no new worktree, no git operations. The two sessions
 * coexist in the same folder; the source is left completely untouched.
 */
async function forkToLocal(
  record: SessionRecord,
  harness: Harness,
  ctx: ForkContext,
  sourceCwd: string,
): Promise<SessionForkResult> {
  const result = await persistFork(record, harness, ctx, sourceCwd, record.worktreePath, record.gitBranch, async () => {})
  if (result.ok) log.info('[session-fork] forked %s → %s (local %s)', record.id, result.sessionId, sourceCwd)
  return result
}

/**
 * Fork a session's conversation into a new independent session. The source is
 * left completely untouched. `req.mode` selects a fresh detached worktree
 * (default) or an in-place fork sharing the source's working directory.
 *
 * `req.forkFromMessageId` truncates the fork at a chosen message; the source
 * harness resolves it to a transcript truncation point. Omit for a full copy.
 *
 * Fork is a *cold* operation — it works on the persisted transcript and never
 * needs a live `Session`. All harness-specific cloning lives behind
 * `Harness.forkTranscript`, so adding a harness touches only its registry entry.
 */
export async function forkSession(req: SessionForkRequest): Promise<SessionForkResult> {
  const record = getSessionRecord(req.sessionId)
  if (!record) return { ok: false, error: 'Source session not found' }
  if (!record.providerSessionId) {
    return { ok: false, error: 'This session has no conversation to fork yet' }
  }
  const harness = harnessRegistry.get(record.harnessId)
  if (!harness) return { ok: false, error: `Unknown harness: ${record.harnessId}` }

  const sourceCwd = record.worktreePath && existsSync(record.worktreePath)
    ? record.worktreePath
    : record.projectPath

  // A full copy needs no transcript — only the truncating path loads it.
  const messages = req.forkFromMessageId
    ? loadSessionStateBySid(req.sessionId)?.messages ?? []
    : []
  const ctx: ForkContext = { messages, forkFromMessageId: req.forkFromMessageId }

  return (req.mode ?? 'worktree') === 'local'
    ? forkToLocal(record, harness, ctx, sourceCwd)
    : forkToNewWorktree(record, harness, ctx, sourceCwd)
}
