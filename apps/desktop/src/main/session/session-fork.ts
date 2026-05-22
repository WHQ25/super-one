import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk'
import type { SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import log from '../logger'
import { gitRun } from '../git-run'
import { activateWorktree, gitErrorMessage } from '../git/worktree-ops'
import { getSharedCodexService } from '../codex/codex-experiment-service'
import { forkSessionRecord, getSessionRecord, type SessionRecord } from './session-repo'

/**
 * Where to truncate the forked conversation. Both fields omitted = full copy.
 * Claude slices by SDK message UUID; Codex rolls back by turn count.
 */
interface ForkTruncation {
  upToMessageId?: string
  dropTrailingTurns?: number
}

/** Replicate the SDK's project-dir slug (F0 in sdk.mjs): non-alphanumeric → '-'. */
function projectSlug(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function claudeProjectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'projects')
}

/**
 * Fork a Claude SDK transcript and relocate the new `.jsonl` into `targetCwd`'s
 * project directory, so a plain `resume` with `cwd=targetCwd` finds it.
 *
 * The CLI's `--resume` is cwd-scoped (it does not search across project dirs),
 * and the SDK resolves the project dir from `realpath(cwd)`. So the forked file
 * — which `forkSession()` writes next to the source — must live under
 * `~/.claude/projects/<slug(realpath(targetCwd))>/`. For a local fork the
 * destination already equals the source dir, so the move is skipped. See
 * reference memory `reference-sdk-fork-session-cwd-scoped`.
 *
 * `upToMessageId` slices the transcript up to that SDK assistant message UUID
 * (inclusive); omitted = full copy.
 */
async function forkClaudeTranscript(
  sourceProviderSessionId: string,
  targetCwd: string,
  upToMessageId?: string,
): Promise<string> {
  const { sessionId: newSdkId } = await sdkForkSession(
    sourceProviderSessionId,
    upToMessageId ? { upToMessageId } : undefined,
  )
  const projectsDir = claudeProjectsDir()
  let forkedFile: string | null = null
  for (const dir of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, dir, `${newSdkId}.jsonl`)
    if (existsSync(candidate)) { forkedFile = candidate; break }
  }
  if (!forkedFile) throw new Error(`forked transcript ${newSdkId}.jsonl not found`)
  const destDir = join(projectsDir, projectSlug(realpathSync(targetCwd)))
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${newSdkId}.jsonl`)
  if (dest !== forkedFile) renameSync(forkedFile, dest)
  return newSdkId
}

/**
 * Fork a Codex thread via the app-server `thread/fork` (a full clone with a
 * fresh thread id). When `dropTrailingTurns > 0`, `thread/rollback` then
 * truncates the new thread to the chosen message. Both calls run on one
 * connection so the rollback sees the freshly-forked thread.
 *
 * Unlike Claude, no rollout file is relocated: `thread/resume` finds a thread
 * by id and takes `cwd` as a request param, so a worktree fork just resumes
 * the new id with the worktree path later.
 */
async function forkCodexThread(record: SessionRecord, dropTrailingTurns: number): Promise<string> {
  return getSharedCodexService().withAppServerRequest(record.projectPath, async (request) => {
    const forked = await request('thread/fork', { threadId: record.providerSessionId })
    const thread = forked.thread as { id?: unknown } | undefined
    const newThreadId = typeof thread?.id === 'string' ? thread.id : null
    if (!newThreadId) throw new Error('Codex thread/fork did not return a thread id')
    if (dropTrailingTurns > 0) {
      await request('thread/rollback', { threadId: newThreadId, numTurns: dropTrailingTurns })
    }
    return newThreadId
  })
}

/** Dispatch the transcript fork to the source session's harness. */
async function forkTranscript(
  record: SessionRecord,
  targetCwd: string,
  trunc: ForkTruncation,
): Promise<string> {
  if (record.harnessId === 'codex') {
    return forkCodexThread(record, trunc.dropTrailingTurns ?? 0)
  }
  return forkClaudeTranscript(record.providerSessionId!, targetCwd, trunc.upToMessageId)
}

function forkTitle(title: string | null): string {
  const base = title?.trim() || 'Session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

/**
 * Fork the SDK transcript into `targetCwd` and persist a cloned session record.
 * Shared by both fork modes; `worktreePath` / `gitBranch` are written onto the
 * new record (both null for a local fork that stays in the main repo).
 * `rollback` undoes any side effect (e.g. a freshly created worktree) on failure.
 */
async function persistFork(
  record: SessionRecord,
  targetCwd: string,
  worktreePath: string | null,
  gitBranch: string | null,
  trunc: ForkTruncation,
  rollback: () => Promise<void>,
): Promise<SessionForkResult> {
  let newSdkSessionId: string
  try {
    newSdkSessionId = await forkTranscript(record, targetCwd, trunc)
  } catch (err) {
    await rollback()
    return { ok: false, error: `Fork transcript failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const newSessionId = randomUUID()
  try {
    forkSessionRecord({
      sourceId: record.id,
      newId: newSessionId,
      providerSessionId: newSdkSessionId,
      worktreePath,
      gitBranch,
      title: forkTitle(record.title),
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
async function forkToNewWorktree(record: SessionRecord, sourceCwd: string, trunc: ForkTruncation): Promise<SessionForkResult> {
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

  const result = await persistFork(record, worktreePath, worktreePath, null, trunc, rollback)
  if (result.ok) log.info('[session-fork] forked %s → %s (worktree %s)', record.id, result.sessionId, worktreePath)
  return result
}

/**
 * Branch the conversation into an independent session that shares the source's
 * own working directory — no new worktree, no git operations. The two sessions
 * coexist in the same folder; the source is left completely untouched.
 */
async function forkToLocal(record: SessionRecord, sourceCwd: string, trunc: ForkTruncation): Promise<SessionForkResult> {
  const result = await persistFork(record, sourceCwd, record.worktreePath, record.gitBranch, trunc, async () => {})
  if (result.ok) log.info('[session-fork] forked %s → %s (local %s)', record.id, result.sessionId, sourceCwd)
  return result
}

/**
 * Fork a session's conversation into a new independent session. The source is
 * left completely untouched. `req.mode` selects a fresh detached worktree
 * (default) or an in-place fork sharing the source's working directory.
 *
 * `req.upToMessageId` (Claude) / `req.dropTrailingTurns` (Codex) truncate the
 * fork at a chosen message; omit both for a full copy.
 */
export async function forkSession(req: SessionForkRequest): Promise<SessionForkResult> {
  const record = getSessionRecord(req.sessionId)
  if (!record) return { ok: false, error: 'Source session not found' }
  if (!record.providerSessionId) {
    return { ok: false, error: 'This session has no conversation to fork yet' }
  }

  const sourceCwd = record.worktreePath && existsSync(record.worktreePath)
    ? record.worktreePath
    : record.projectPath

  const trunc: ForkTruncation = {
    upToMessageId: req.upToMessageId,
    dropTrailingTurns: req.dropTrailingTurns,
  }

  return (req.mode ?? 'worktree') === 'local'
    ? forkToLocal(record, sourceCwd, trunc)
    : forkToNewWorktree(record, sourceCwd, trunc)
}
