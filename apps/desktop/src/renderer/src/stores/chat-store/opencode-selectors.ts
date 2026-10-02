import type { OpenCodeResources, SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState } from './types'

const EMPTY_COMMANDS: SlashCommandInfo[] = []
const EMPTY_AGENTS: OpenCodeResources['agents'] = []

export const selectOpenCodeCommands = (state: ChatStore): SlashCommandInfo[] =>
  state.harnessResources.opencode?.commands ?? EMPTY_COMMANDS

export const selectOpenCodeAgents = (state: ChatStore): OpenCodeResources['agents'] =>
  state.harnessResources.opencode?.agents ?? EMPTY_AGENTS

/** The session's own project list once its runtime reported one, else the harness catalog. */
export function openCodeAgentsFor(
  state: ChatStore,
  session: Pick<PerSessionState, 'sessionAgents'>,
): OpenCodeResources['agents'] {
  return session.sessionAgents ?? selectOpenCodeAgents(state)
}
