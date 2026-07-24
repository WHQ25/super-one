import type { OpenCodeResources, SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatStore } from './types'

const EMPTY_COMMANDS: SlashCommandInfo[] = []
const EMPTY_AGENTS: OpenCodeResources['agents'] = []

export const selectOpenCodeCommands = (state: ChatStore): SlashCommandInfo[] =>
  state.harnessResources.opencode?.commands ?? EMPTY_COMMANDS

export const selectOpenCodeAgents = (state: ChatStore): OpenCodeResources['agents'] =>
  state.harnessResources.opencode?.agents ?? EMPTY_AGENTS
