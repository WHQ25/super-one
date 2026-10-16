import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { SessionAgentLaunchSettings } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import {
  findSuggestedTask, suggestedTaskBranchName, suggestedTaskInitialChoice, suggestedTaskRunSettings,
  type SuggestedTaskInput, type SuggestedTaskLaunchChoice, type SuggestedTaskLaunchOptions,
} from '@superone/shared/suggested-task'
import { recordApprovedLaunch, CollaborationError } from '@superone/runtime/collaboration'
import { suggestedTaskToolResult } from '@superone/runtime/collaboration/suggested-task'
import { collaborationLaunchDefaults } from './collaboration-profiles'
import { resolveProfile, type CollaborationContext } from './collaboration-context'
import { startCollaboration } from './collaboration-start'

const exec = promisify(execFile)

function pending(ctx: CollaborationContext, sessionId: string, taskId: string) {
  const parent = ctx.deps.sessions.get(sessionId)
  if (!parent || parent.closed) throw new CollaborationError('This session is no longer available.', 'not_found')
  const found = findSuggestedTask(ctx.deps.sessions.messages(sessionId), taskId)
  if (!found) throw new CollaborationError(`No suggested task ${taskId} in this session.`, 'not_found')
  if (found.state) throw new CollaborationError(`Suggested task ${taskId} was already ${found.state.status}.`, 'failed_precondition')
  return { parent, input: found.input }
}

export function suggestTask(ctx: CollaborationContext, sessionId: string, args: unknown) {
  const parent = ctx.deps.sessions.get(sessionId)
  if (!parent || parent.closed) throw new CollaborationError('Session is no longer available.', 'not_found')
  if (parent.externalParent || ctx.store.isSpawnChild(sessionId)) throw new CollaborationError('session_suggest_task is only available in the main session.', 'failed_precondition')
  return suggestedTaskToolResult(args)
}

export async function suggestedTaskOptions(ctx: CollaborationContext, sessionId: string, taskId: string): Promise<SuggestedTaskLaunchOptions> {
  const { parent } = pending(ctx, sessionId, taskId)
  const profiles = ctx.listProfiles()
  if (profiles.some(profile => profile.harnessId === 'claude')) {
    const { getNodeClaudeModelCatalog } = await import('./claude-model-catalog')
    const { resolveClaudeBinaryPath } = await import('./claude-turn-runner')
    const models = await getNodeClaudeModelCatalog({ cwd: parent.cwd || ctx.deps.projects.get(parent.projectId)!.path, binaryPath: resolveClaudeBinaryPath({ harnesses: ctx.deps.harnesses }) })
    if (models.length) for (const profile of profiles) if (profile.harnessId === 'claude') profile.models = models
  }
  const profile = resolveProfile(new Map(profiles.map(item => [item.id, item])), parent.providerId)
  const initial = suggestedTaskInitialChoice(profiles, profile?.id ?? parent.providerId, {
    ...(parent.model ? { model: parent.model } : {}),
    ...(parent.effort ? { effort: parent.effort } : {}),
    ...(parent.permissionMode ? { permissionMode: parent.permissionMode as SessionAgentLaunchSettings['permissionMode'] } : {}),
    ...(parent.claudeFastMode !== undefined && parent.claudeFastMode !== null ? { claudeFastMode: parent.claudeFastMode } : {}),
    ...(parent.apiProviderId ? { apiProviderId: parent.apiProviderId } : {}),
  })
  if (!initial) throw new CollaborationError('No agent can launch new sessions.', 'failed_precondition')
  return { profiles, initial }
}

/** The project and worktree are resolved on this node, from the stored card's cwd. */
async function taskLocation(ctx: CollaborationContext, projectId: string, cwd: string, input: SuggestedTaskInput, taskId: string, assertControl: () => void) {
  const allowed = await ctx.deps.workspaceGit.isAllowedSessionCwd(projectId, cwd)
  assertControl()
  if (!allowed) projectId = ctx.deps.projects.open(cwd).projectId
  let head: string
  try { head = (await exec('git', ['-C', cwd, 'rev-parse', 'HEAD'])).stdout.trim() }
  catch { return { projectId, cwd } }
  return { projectId, cwd, worktree: { enabled: true, baseBranch: head, mode: 'branch' as const, branchName: suggestedTaskBranchName(input.title, taskId) } }
}

/** One host-owned handoff; the captured source-session proof fences asynchronous preparation. */
export async function launchNodeSuggestedTask(ctx: CollaborationContext, sessionId: string, taskId: string, choice: SuggestedTaskLaunchChoice | undefined, assertControl: () => void, controllerClientSessionId: string) {
  assertControl()
  const { parent, input } = pending(ctx, sessionId, taskId)
  const launchId = `suggested-task-${taskId}`
  if (!ctx.store.grantForLaunch(sessionId, launchId)?.started_at) {
    const { profiles, initial } = await suggestedTaskOptions(ctx, sessionId, taskId)
    assertControl()
    const selected = choice ?? initial
    const profile = profiles.find(item => item.id === selected.agentId)
    if (!profile) throw new CollaborationError(`Unknown agent profile: ${selected.agentId}`, 'invalid_argument')
    const cwd = resolve(input.cwd || parent.cwd || ctx.deps.projects.get(parent.projectId)!.path)
    const location = await taskLocation(ctx, parent.projectId, cwd, input, taskId, assertControl)
    assertControl()
    const settings = suggestedTaskRunSettings(profile, selected.settings, false)
    const config = { ...collaborationLaunchDefaults(ctx.deps, profile, settings), ...settings, ...location, name: input.title, role: 'Task' }
    recordApprovedLaunch(ctx.store, sessionId, { launchId, mode: 'handoff', agentId: profile.id, summary: input.tldr || input.title, name: input.title, role: 'Task', config }, config)
  }
  assertControl()
  const started = await startCollaboration(ctx, { callerSessionId: sessionId, launchId, task: input.prompt, controllerClientSessionId, assertControl })
  ctx.deps.sessions.rename(started.sessionId, input.title, 'agent')
  ctx.deps.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent,
    payload: { event: { type: 'suggested_task_updated', taskId, state: { status: 'launched', sessionId: started.sessionId } } } })
  return { sessionId: started.sessionId }
}
