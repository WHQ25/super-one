/**
 * What `session_collab_list_agents` returns, shared by desktop and CLI nodes.
 * The list is for picking a delegate; what a launch of one agent can set
 * (defaults, models, efforts, keys) loads only when the agent passes its id.
 */

import type { SessionAgentProfile } from './agent-types'

type ListedProfile = Pick<SessionAgentProfile, 'id' | 'name' | 'harnessId' | 'acpAgentId' | 'description'>

/** One agent in the id-less list: enough to choose it. */
export function collabAgentSummary(profile: ListedProfile): ListedProfile {
  return {
    id: profile.id,
    name: profile.name,
    harnessId: profile.harnessId,
    ...(profile.acpAgentId ? { acpAgentId: profile.acpAgentId } : {}),
    ...(profile.description ? { description: profile.description } : {}),
  }
}

/** One agent with `id`: what a launch of it can set. `brandKey` is UI-only. */
export function collabAgentDetail<T extends { brandKey?: string }>(profile: T): Omit<T, 'brandKey'> {
  const { brandKey: _brandKey, ...detail } = profile
  return detail
}

/** For an id the list does not have: points the agent back at the list. */
export function unknownCollabAgentMessage(id: string, environment?: string): string {
  return environment
    ? `Agent ${id} is not available on environment ${environment}. Call session_collab_list_agents without id and pick one from environments[].agents.`
    : `Unknown agent ${id}. Call session_collab_list_agents without id to see the available agents.`
}
