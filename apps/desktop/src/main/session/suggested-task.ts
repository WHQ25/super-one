/**
 * Host side of suggested-task cards (`session_suggest_task`): the user's launch.
 * The click is the approval, so a launch
 * records a handoff grant and starts it through the same path as an approved
 * `session_collab_request` handoff — a new top-level sibling whose opening turn
 * is the brief plus a provenance line.
 */
import type { SessionAgentLaunchSettings, SessionAgentProfile, SessionAgentWorktreeConfig } from '@superone/shared/agent-types'
import {
  findSuggestedTask,
  type SuggestedTaskActionResult,
  type SuggestedTaskInput,
  type SuggestedTaskLaunchChoice,
  type SuggestedTaskLaunchOptions,
} from '@superone/shared/suggested-task'
import { resolveMainWorktreeDir } from '../git/worktree-ops'
import { listSessionAgentProfiles } from './agent-profiles'
import { resolveCwd } from './collaboration-child-project'
import { resolveLiveSession } from './collaboration-host'
import { collaborationStore as store } from './collaboration-mailbox'
import { createGrants, startSessionAgent } from './session-collaboration'
import type { Session, SessionManager } from './types'

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
export function suggestedTaskBranchName(title: string, taskId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  const id = taskId.replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `task/${slug ? `${slug}-` : ''}${id}`
}

/** A fresh branch from the checkout's HEAD when it is a git repo; a plain folder is shared as is. */
async function defaultWorktree(cwd: string, title: string, taskId: string): Promise<SessionAgentWorktreeConfig | undefined> {
  try {
    await resolveMainWorktreeDir(cwd)
  } catch {
    return undefined
  }
  return { enabled: true, baseBranch: 'HEAD', mode: 'branch', branchName: suggestedTaskBranchName(title, taskId) }
}

const LAUNCH_SETTING_KEYS = ['model', 'effort', 'fastMode', 'apiProviderId', 'permissionMode', 'sandboxMode'] as const satisfies readonly (keyof SessionAgentLaunchSettings)[]

/** Only how the launch runs comes from the renderer; where and what it runs is the host's. */
function pickSettings(settings: SessionAgentLaunchSettings): SessionAgentLaunchSettings {
  return Object.fromEntries(LAUNCH_SETTING_KEYS.flatMap((key) => (settings[key] === undefined ? [] : [[key, settings[key]]])))
}

/** The suggesting session's agent, running as that session does; the first launchable agent otherwise. */
function initialChoice(parent: Pick<Session, 'snapshot' | 'getUiSettings'>, profiles: SessionAgentProfile[]): SuggestedTaskLaunchChoice | null {
  const own = profiles.find((item) => item.id === parent.snapshot.providerId)
  if (!own) return profiles[0] ? { agentId: profiles[0].id, settings: {} } : null
  const ui = parent.getUiSettings()
  return {
    agentId: own.id,
    settings: {
      ...(ui.permissionMode ? { permissionMode: ui.permissionMode } : {}),
      ...(ui.selectedModel ? { model: ui.selectedModel } : {}),
      ...(ui.selectedEffort ? { effort: ui.selectedEffort } : {}),
      ...(ui.apiProviderId ? { apiProviderId: ui.apiProviderId } : {}),
    },
  }
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
): Promise<string> {
  const key = `${sessionId}:${taskId}`
  const inflight = launching.get(key)
  if (inflight) return inflight
  const run = launch(host, sessionId, taskId, choice).finally(() => launching.delete(key))
  launching.set(key, run)
  return run
}

async function launch(host: SessionManager, parentSessionId: string, taskId: string, requested?: SuggestedTaskLaunchChoice): Promise<string> {
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
    const name = input.title
    const role = 'Task'
    createGrants(parentSessionId, [{
      launchId,
      mode: 'handoff',
      agentId: profile.id,
      summary: input.tldr || input.title,
      name,
      role,
      config: {
        ...profile.defaultConfig,
        ...pickSettings(choice.settings ?? {}),
        cwd,
        ...(worktree ? { worktree } : {}),
        name,
        role,
      },
    }])
  }
  const reply = await startSessionAgent(parentSessionId, { launchId, task: input.prompt }, host)
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
