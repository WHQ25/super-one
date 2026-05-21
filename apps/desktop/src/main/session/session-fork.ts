import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk'
import type { SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import log from '../logger'
import { gitRun } from '../git-run'
import { activateWorktree, gitErrorMessage } from '../git/worktree-ops'
import { forkSessionRecord, getSessionRecord } from './session-repo'

/** Replicate the SDK's project-dir slug (F0 in sdk.mjs): non-alphanumeric → '-'. */
function projectSlug(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function claudeProjectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'projects')
}

/**
 * Fork the SDK transcript and relocate the new `.jsonl` into the worktree's
 * project directory, so a plain `resume` with `cwd=worktree` finds it.
 *
 * The CLI's `--resume` is cwd-scoped (it does not search across project dirs),
 * and the SDK resolves the project dir from `realpath(cwd)`. So the forked file
 * — which `forkSession()` writes next to the source — must be moved to
 * `~/.claude/projects/<slug(realpath(worktree))>/`. See reference memory
 * `reference-sdk-fork-session-cwd-scoped`.
 */
async function forkSdkTranscript(sourceProviderSessionId: string, worktreePath: string): Promise<string> {
  const { sessionId: newSdkId } = await sdkForkSession(sourceProviderSessionId)
  const projectsDir = claudeProjectsDir()
  let forkedFile: string | null = null
  for (const dir of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, dir, `${newSdkId}.jsonl`)
    if (existsSync(candidate)) { forkedFile = candidate; break }
  }
  if (!forkedFile) throw new Error(`forked transcript ${newSdkId}.jsonl not found`)
  const destDir = join(projectsDir, projectSlug(realpathSync(worktreePath)))
  mkdirSync(destDir, { recursive: true })
  renameSync(forkedFile, join(destDir, `${newSdkId}.jsonl`))
  return newSdkId
}

function forkTitle(title: string | null): string {
  const base = title?.trim() || 'Session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

/**
 * Fork a session's conversation into a brand-new git worktree running an
 * independent session. The source session is left completely untouched.
 */
export async function forkSessionToWorktree(req: SessionForkRequest): Promise<SessionForkResult> {
  const record = getSessionRecord(req.sessionId)
  if (!record) return { ok: false, error: 'Source session not found' }
  if (!record.providerSessionId) {
    return { ok: false, error: 'This session has no conversation to fork yet' }
  }

  const sourceCwd = record.worktreePath && existsSync(record.worktreePath)
    ? record.worktreePath
    : record.projectPath

  // The fork's worktree is checked out detached at the source's current commit
  // — that keeps the forked code state coherent with the forked conversation,
  // and (like Codex's worktree fork) leaves no stray branch behind. The user
  // can create a branch later if the exploration turns out worth keeping.
  // A fork always reproduces the source's full working state — HEAD plus every
  // uncommitted change — so the forked conversation lands on identical code.
  let worktreePath: string
  try {
    const wt = await activateWorktree(sourceCwd, {
      baseBranch: 'HEAD',
      mode: 'detach',
      carryLocalChanges: true,
    })
    worktreePath = wt.path
  } catch (err) {
    return { ok: false, error: gitErrorMessage(err) }
  }

  const cleanupWorktree = async () => {
    try {
      await gitRun(sourceCwd, ['worktree', 'remove', '--force', worktreePath])
    } catch (err) {
      log.warn('[session-fork] worktree cleanup after failure failed:', err)
    }
  }

  let newSdkSessionId: string
  try {
    newSdkSessionId = await forkSdkTranscript(record.providerSessionId, worktreePath)
  } catch (err) {
    await cleanupWorktree()
    return { ok: false, error: `Fork transcript failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const newSessionId = randomUUID()
  try {
    forkSessionRecord({
      sourceId: req.sessionId,
      newId: newSessionId,
      providerSessionId: newSdkSessionId,
      worktreePath,
      gitBranch: null,
      title: forkTitle(record.title),
    })
  } catch (err) {
    await cleanupWorktree()
    return { ok: false, error: `Persisting forked session failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  log.info('[session-fork] forked %s → %s (worktree %s)', req.sessionId, newSessionId, worktreePath)
  return { ok: true, sessionId: newSessionId, worktreePath }
}
