import {
  SESSION_AGENT_LAUNCHES_FIELD,
  type SessionAgentLaunchProposal,
  type SessionAgentRequestPayload,
} from '@superone/shared/agent-types'

export function resolveCollaborationLaunches(
  payload: SessionAgentRequestPayload,
): SessionAgentLaunchProposal[] {
  return payload.launches.map((launch) => ({
    ...launch,
    config: {
      ...payload.profiles.find((profile) => profile.id === launch.agentId)?.defaultConfig,
      ...launch.config,
    },
  }))
}

export function buildCollaborationFormAnswers(
  payload: SessionAgentRequestPayload,
): Record<string, unknown> {
  return {
    [SESSION_AGENT_LAUNCHES_FIELD]: JSON.stringify(resolveCollaborationLaunches(payload)),
  }
}

export function collaborationLaunchLabel(launch: SessionAgentLaunchProposal): string {
  if (launch.mode === 'handoff') return 'Hand off to'
  if (launch.mode === 'link') return 'Work with'
  return 'Launch'
}
