import type {
  SessionAgentLaunchConfig,
  SessionAgentLaunchProposal,
  SessionCollabLaunchMode,
} from '@superone/shared/agent-types'
import { CollaborationError } from './errors'
import { collaborationSessionTitle, normalizeStartTask, parseGrantConfig, resolveLaunchMode } from './launch'
import type { CollaborationGrantRow, CollaborationStore } from './store'

/** What session_collab_request returns for one approved launch. */
export interface ApprovedLaunch {
  launchId: string
  mode: SessionCollabLaunchMode
  agentId: string
  /** Link only: the existing peer session. */
  sessionId?: string
  summary: string
  name: string
  role: string
  title: string
  config: SessionAgentLaunchConfig
  reused: boolean
}

export const START_APPROVED_LAUNCHES_HINT =
  'Start each launch with session_collab_start({ launchId, task }); task is the full Markdown brief '
  + '(optional for link, where it becomes the opening message).'

/**
 * Persist one confirmed launch. Re-approving the caller's existing link reuses
 * its grant, re-pointed at the new launchId. `config` is the host-resolved
 * launch config for spawn/handoff; link grants derive theirs from the proposal.
 */
export function recordApprovedLaunch(
  store: CollaborationStore,
  parentSessionId: string,
  launch: SessionAgentLaunchProposal,
  config: SessionAgentLaunchConfig,
): { grantId: string; approved: ApprovedLaunch } {
  const mode = resolveLaunchMode(launch.mode)
  const { launchId, summary, name, role } = launch
  const title = collaborationSessionTitle(name, role)
  if (mode === 'link') {
    const peerSessionId = launch.sessionId?.trim()
    if (!peerSessionId) throw new CollaborationError('Link launches require sessionId', 'invalid_argument')
    const existing = store.findLinkGrant(parentSessionId, peerSessionId)
    if (existing) {
      const existingConfig = { ...parseGrantConfig(existing.config_json), launchId }
      store.updateConfig(existing.grant_id, existingConfig)
      return {
        grantId: existing.grant_id,
        approved: {
          launchId, mode, agentId: existing.agent_id, sessionId: peerSessionId, summary, name, role, title,
          config: existingConfig, reused: true,
        },
      }
    }
    const linkConfig = {
      launchId,
      name,
      role,
      summary,
      peerSessionId,
      peerTitle: launch.peerTitle,
      peerProjectPath: launch.peerProjectPath,
    }
    const grantId = store.createGrant({
      kind: 'link', parentSessionId, childSessionId: peerSessionId, agentId: '', config: linkConfig,
    })
    return {
      grantId,
      approved: {
        launchId, mode, agentId: '', sessionId: peerSessionId, summary, name, role, title,
        config: linkConfig, reused: false,
      },
    }
  }
  const grantConfig = { ...config, launchId, name, role, summary }
  const grantId = store.createGrant({ kind: mode, parentSessionId, agentId: launch.agentId, config: grantConfig })
  return {
    grantId,
    approved: {
      launchId, mode, agentId: launch.agentId, summary, name, role, title, config: grantConfig, reused: false,
    },
  }
}

/**
 * session_collab_start: the approved launch is found by the launchId the
 * request returned, scoped to the calling session, and receives its brief here
 * rather than at request time. A retry keeps the first brief.
 */
export function prepareLaunchStart(
  store: CollaborationStore,
  callerSessionId: string,
  input: { launchId?: unknown; task?: unknown },
): CollaborationGrantRow {
  const launchId = typeof input.launchId === 'string' ? input.launchId.trim() : ''
  if (!launchId) throw new CollaborationError('launchId is required', 'invalid_argument')
  const grant = store.grantForLaunch(callerSessionId, launchId)
  if (!grant) {
    throw new CollaborationError(
      `No approved launch "${launchId}" in this session. Pass a launchId returned by session_collab_request.`,
      'not_found',
    )
  }
  // A retry keeps the recorded brief, so it may omit task.
  if (grant.task_sent === 1 || grant.task) return grant
  const task = normalizeStartTask(grant.kind, input.task)
  if (!task) return grant
  store.setTask(grant.grant_id, task)
  return { ...grant, task }
}
