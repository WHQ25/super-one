import type { OpenCodeAgentOption, ModelOption } from '../agent-types'
import type { SlashCommandInfo } from '../slash-command-types'
import type { HarnessCapabilities } from './harness-capabilities'
import type { HarnessId } from './harness-id'

/** Facts negotiated with a live runtime, rather than guaranteed by its harness. */
export interface HarnessRuntimeCapabilities extends Partial<Pick<HarnessCapabilities,
  'supportsQueuedSteer' | 'supportsQueuedSteerSoon' | 'supportsStreamingToolInput'
>> {
  harnessId: HarnessId
}

/** Native session catalog; Session caches/replays the complete envelope. */
export interface SessionAgentsEvent {
  type: 'session_agents'
  agents: OpenCodeAgentOption[]
  runtimeCapabilities?: HarnessRuntimeCapabilities
  commands?: SlashCommandInfo[]
  models?: ModelOption[]
}
