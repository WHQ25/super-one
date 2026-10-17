import type { AgentProfileDraft, HarnessId, SessionAgentLaunchConfig, SessionAgentProfile } from './agent-types'
import type { AgentProfileCatalog, AgentProfileSpec } from './agent-profile'
import { AGENT_PROFILE_VERSION, parseAgentProfileSpec } from './agent-profile'

export function parseManagedProfileDraft(draft: AgentProfileDraft, harnessId: HarnessId) {
  return parseAgentProfileSpec({
    version: AGENT_PROFILE_VERSION,
    identity: { name: draft?.name, description: draft?.description },
    instructions: draft?.instructions,
    runtime: { model: draft?.model, effort: draft?.effort, permissionMode: draft?.permissionMode, options: draft?.options },
  }, harnessId)
}

/** Human settings UI only; these channels are not exposed as agent tools or node RPC. */
export const AGENT_PROFILE_CHANNELS = {
  list: 'agent-profiles:list',
  get: 'agent-profiles:get',
  save: 'agent-profiles:save',
  delete: 'agent-profiles:delete',
} as const

export interface ManagedAgentProfile {
  id: string
  name: string
  harnessId: HarnessId
  acpAgentId?: string
  description: string
  followsDefaults: boolean
  available: boolean
  approved: boolean
}

export interface AgentProfileManagementDetail extends ManagedAgentProfile {
  spec: AgentProfileSpec
  agent: SessionAgentProfile
  catalog: AgentProfileCatalog
  baseConfig: SessionAgentLaunchConfig
  version: string
  /** Binds the displayed defaults, provider identity and catalog, without exposing secrets. */
  reviewToken: string
}

export interface SaveManagedAgentProfile {
  /** Omit to create a new Profile on sourceId's harness. */
  id?: string
  sourceId: string
  version: string
  reviewToken: string
  draft: AgentProfileDraft
}

export interface AgentProfileManagementAPI {
  list(): Promise<ManagedAgentProfile[]>
  get(id: string): Promise<AgentProfileManagementDetail>
  save(input: SaveManagedAgentProfile): Promise<{ id: string }>
  delete(input: { id: string; version: string }): Promise<void>
}
