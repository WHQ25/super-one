import { randomUUID } from 'node:crypto'
import type { SessionHostPort } from '@superone/runtime/server'
import type { PermissionMode, SandboxMode, SendMessageRequest } from '@superone/shared/agent-types'
import { sanitizeGitRef } from '@superone/runtime/git'
import { gitRun } from '../git-run'
import { activateWorktree } from '../git/worktree-ops'
import type { LocalSessionHostDeps } from './local-session-host'
import { applyDesktopSessionSettings } from './desktop-session-mutations'
import log from '../logger'

type Create = NonNullable<SessionHostPort['createOnHost']>
const refused = (message: string) => Object.assign(new Error(message), { code: 'failed_precondition' })

/** Resolve native creation choices before persisting a row; draft control is rechecked after Git work. */
export async function createDesktopSession(deps: LocalSessionHostDeps, input: Parameters<Create>[0], options: Parameters<Create>[1]) {
  const projectPath = deps.projectPath(input.projectId)
  if (!projectPath) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  const sessionId = input.sessionId ?? randomUUID()
  const existingRow = deps.rows.get(sessionId)
  const existing = deps.sessions.getSession(sessionId)
  const draft = input.draftId ? deps.drafts?.list().find((item) => item.id === input.draftId) : undefined
  const promoted = draft?.originSessionId === sessionId && draft.projectPath === projectPath
  if (input.draftId && (!draft || draft.projectPath !== projectPath)) throw refused('Draft does not belong to this project')
  if (existingRow || existing) {
    if (!promoted || (existingRow && existingRow.projectPath !== projectPath) || (existing && existing.projectPath !== projectPath)
      || deps.rows.loadMessages(sessionId, 1).messages.length || existing?.snapshot.messages.length) throw refused('Session already exists')
    if (existing?.isStreaming()) throw refused('Draft session is running')
  }
  options.assertCreate()
  let cwd = input.cwd ?? projectPath
  let gitBranch: string | null | undefined = input.gitBranch
  let createdWorktree: string | null = null
  let persisted = false
  try {
    if (input.worktreeBranch) {
      if (cwd !== projectPath) throw Object.assign(new Error('cwd and worktreeBranch cannot be combined'), { code: 'invalid_argument' })
      const mode = input.worktreeMode ?? 'branch'
      const activated = await activateWorktree(projectPath, { baseBranch: input.worktreeBranch, mode, branchName: input.worktreeBranchName ?? (mode === 'branch' ? input.worktreeBranch : undefined), carryLocalChanges: input.worktreeCarryLocalChanges })
      cwd = createdWorktree = activated.path
      gitBranch = activated.recordedBranch
      options.assertCreate()
    } else if (cwd === projectPath && input.gitBranch) {
      const current = (await gitRun(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      options.assertCreate()
      if (current !== input.gitBranch) await gitRun(projectPath, ['checkout', sanitizeGitRef(input.gitBranch)])
      options.assertCreate()
    }
    // Replace the empty draft runtime so its new harness and agent are used.
    if (existing) {
      existing.lease.grantCreatedSession()
      await deps.sessions.disposeSession(sessionId)
    }
    options.assertCreate()
    if (!deps.edits) throw refused('Session persistence is not available')
    if (!existingRow) deps.edits.create({ sessionId, projectPath, cwd, title: input.title })
    persisted = true
    const settings = options.settings
    const session = deps.sessions.createSession({
      id: sessionId, projectPath, cwd, providerId: input.providerId ?? `${input.harnessId ?? 'claude'}-base`, title: input.title,
      systemPromptAppend: input.systemPromptAppend ?? undefined,
      permissionMode: settings.permissionMode as PermissionMode | undefined,
      sandboxMode: settings.sandboxMode as SandboxMode | undefined,
      model: settings.model ?? undefined, effort: settings.effort as SendMessageRequest['effort'] | undefined,
      apiProviderId: input.apiProviderId, acpAgentId: input.acpAgentId ?? null,
      additionalDirectories: settings.additionalDirectories ?? undefined,
      ...(gitBranch !== undefined ? { gitBranch } : {}),
    })
    session.lease.grantCreatedSession()
    options.assertCreate()
    await applyDesktopSessionSettings(session, settings)
    return session
  } catch (error) {
    if (!existingRow && persisted) {
      try { await deps.edits?.close(sessionId); deps.edits?.remove(sessionId) }
      catch (cleanupError) { log.warn('[desktop-session-create] session cleanup failed: %s', cleanupError) }
    }
    if (createdWorktree && (!persisted || !existingRow)) {
      try { await gitRun(projectPath, ['worktree', 'remove', '--force', createdWorktree]) }
      catch (cleanupError) { log.warn('[desktop-session-create] worktree cleanup failed: %s', cleanupError) }
    }
    throw error
  }
}
