/**
 * Host side of suggested-task cards (`session_suggest_task`): the user's launch.
 * The click is the approval, so a launch
 * records a handoff grant and starts it through the same path as an approved
 * `session_collab_request` handoff — a new top-level sibling whose opening turn
 * is the brief plus a provenance line.
 */
import type { SessionAgentProfile, SessionAgentWorktreeConfig } from '@superone/shared/agent-types'
import {
  findSuggestedTask,
  suggestedTaskInitialChoice,
  suggestedTaskRunSettings,
  suggestedTaskBranchName,
  type SuggestedTaskActionResult,
  type SuggestedTaskInput,
  type SuggestedTaskLaunchChoice,
  type SuggestedTaskLaunchOptions,
} from '@superone/shared/suggested-task'
import { resolveMainWorktreeDir } from '../git/worktree-ops'
import { listSessionAgentProfiles, sessionAgentLaunchDefaults } from './agent-profiles'
import { resolveCwd } from './collaboration-child-project'
import { resolveLiveSession } from './collaboration-host'
import { collaborationStore as store } from './collaboration-mailbox'
import { createGrants, startSessionAgent } from './session-collaboration'
import type { Session, SessionManager } from './types'
import { runHostReaction } from './control-context'

type CardSession = Pick<Session, 'snapshot' | 'emitHostEvent'>

/** An expected refusal; its message is shown on the card as is. */
export class SuggestedTaskError extends Error {}

/** The IPC reply: an expected refusal becomes a message for the card instead of a rejected invoke. */
export async function suggestedTaskReply<T extends object>(run: () => Promise<T | void>): Promise<SuggestedTaskActionResult<T>> {
  try {
    return { ok: true, ...(await run() ?? {}) } as SuggestedTaskActionResult<T>
  } catch (error) {
    if (error instanceof SuggestedTaskError) return { ok: false, error: error.message }
    throw error
  }
}

function pendingTask(session: CardSession, taskId: string): SuggestedTaskInput {
  const found = findSuggestedTask(session.snapshot.messages, taskId)
  if (!found) throw new SuggestedTaskError(`No suggested task ${taskId} in this session.`)
  if (found.state) throw new SuggestedTaskError(`Suggested task ${taskId} was already ${found.state.status}.`)
  return found.input
}

/** A branch name git accepts for any title; non-Latin titles fall back to the id alone. */
export { suggestedTaskBranchName } from '@superone/shared/suggested-task'

/** A fresh branch from the checkout's HEAD when it is a git repo; a plain folder is shared as is. */
async function defaultWorktree(cwd: string, title: string, taskId: string): Promise<SessionAgentWorktreeConfig | undefined> {
  try {
    await resolveMainWorktreeDir(cwd)
  } catch {
    return undefined
  }
  return { enabled: true, baseBranch: 'HEAD', mode: 'branch', branchName: suggestedTaskBranchName(title, taskId) }
}

/** The suggesting session's agent, running as that session does; the first launchable agent otherwise. */
function initialChoice(parent: Pick<Session, 'snapshot' | 'getUiSettings'>, profiles: SessionAgentProfile[]): SuggestedTaskLaunchChoice | null {
  const ui = parent.getUiSettings()
  return suggestedTaskInitialChoice(profiles, parent.snapshot.providerId, {
    ...(ui.permissionMode ? { permissionMode: ui.permissionMode } : {}),
    ...(ui.selectedModel ? { model: ui.selectedModel } : {}),
    ...(ui.selectedEffort ? { effort: ui.selectedEffort } : {}),
    ...(ui.claudeFastMode !== undefined ? { claudeFastMode: ui.claudeFastMode } : {}),
    ...(ui.apiProviderId ? { apiProviderId: ui.apiProviderId } : {}),
  })
}

/** What the card's launch picker offers for a pending card. */
export function suggestedTaskLaunchOptions(host: SessionManager, sessionId: string, taskId: string): SuggestedTaskLaunchOptions {
  const parent = resolveLiveSession(host, sessionId)
  if (!parent) throw new SuggestedTaskError('This session is no longer available.')
  pendingTask(parent, taskId)
  const profiles = listSessionAgentProfiles()
  const initial = initialChoice(parent, profiles)
  if (!initial) throw new SuggestedTaskError('No agent can launch new sessions.')
  return { profiles, initial }
}

const launching = new Map<string, Promise<string>>()

/**
 * Launch a pending card on the user's pick, or on the suggesting session's own
 * agent and settings; resolves with the new session id. Concurrent clicks share one launch.
 */
export function launchSuggestedTask(
  host: SessionManager,
  sessionId: string,
  taskId: string,
  choice?: SuggestedTaskLaunchChoice,
  assertControl: () => void = () => {},
): Promise<string> {
  assertControl()
  const key = `${sessionId}:${taskId}`
  const inflight = launching.get(key)
  if (inflight) return inflight
  const run = launch(host, sessionId, taskId, choice, assertControl).finally(() => launching.delete(key))
  launching.set(key, run)
  return run
}

async function launch(
  host: SessionManager,
  parentSessionId: string,
  taskId: string,
  requested: SuggestedTaskLaunchChoice | undefined,
  assertControl: () => void,
): Promise<string> {
  const parent = resolveLiveSession(host, parentSessionId)
  if (!parent) throw new SuggestedTaskError('This session is no longer available.')
  const input = pendingTask(parent, taskId)
  const launchId = `suggested-task-${taskId}`
  // A start that already made its session is resumed as it was approved; a
  // grant that never started is superseded by the user's current pick.
  if (!store().grantForLaunch(parentSessionId, launchId)?.started_at) {
    const profiles = listSessionAgentProfiles()
    const choice = requested ?? initialChoice(parent, profiles)
    const profile = profiles.find((item) => item.id === choice?.agentId)
    if (!choice || !profile) {
      throw new SuggestedTaskError(`This agent (${choice?.agentId ?? parent.snapshot.providerId}) cannot launch new sessions.`)
    }
    const cwd = resolveCwd({ cwd: input.cwd }, parent)
    const worktree = await defaultWorktree(cwd, input.title, taskId)
    assertControl()
    const name = input.title
    const role = 'Task'
    const settings = suggestedTaskRunSettings(profile, choice.settings ?? {})
    createGrants(parentSessionId, [{
      launchId,
      mode: 'handoff',
      agentId: profile.id,
      summary: input.tldr || input.title,
      name,
      role,
      config: {
        ...sessionAgentLaunchDefaults(profile, settings),
        ...settings,
        cwd,
        ...(worktree ? { worktree } : {}),
        name,
        role,
      },
    }])
  }
  assertControl()
  // The parent's proof authorizes admission; the new sibling runs as host work.
  const reply = await runHostReaction(() => startSessionAgent(parentSessionId, { launchId, task: input.prompt }, host, assertControl))
  const started = JSON.parse(reply.content[0].text) as { sessionId?: string; message?: string }
  if (reply.isError || !started.sessionId) {
    throw new SuggestedTaskError(started.message ?? 'The task could not be started.')
  }
  // Handoff titles read `Name - Role`; the card's title is the better name.
  host.getSession(started.sessionId)?.setTitle(input.title, 'agent')
  parent.emitHostEvent({
    type: 'suggested_task_updated',
    taskId,
    state: { status: 'launched', sessionId: started.sessionId },
  })
  return started.sessionId
}
