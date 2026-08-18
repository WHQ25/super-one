import type { HarnessId } from './agent-types'

export interface BaseSessionProviderSpec {
  id: string
  name: string
  config: Record<string, unknown>
}

/**
 * Canonical base SessionProvider catalog shared by desktop and remote-node DBs.
 * The Record makes a new HarnessId fail type-checking until its base provider
 * can be seeded everywhere that creates sessions.
 */
export const BASE_SESSION_PROVIDERS = {
  claude: { id: 'claude-base', name: 'Claude (Base)', config: {} },
  codex: { id: 'codex-base', name: 'Codex (Base)', config: {} },
  acp: { id: 'acp-base', name: 'Others (ACP)', config: { agentId: 'grok-build' } },
  opencode: { id: 'opencode-base', name: 'OpenCode (Base)', config: {} },
  cursor: { id: 'cursor-base', name: 'Cursor (Base)', config: {} },
  dsh: { id: 'dsh-base', name: 'DeepSeek (Base)', config: {} },
} satisfies Record<HarnessId, BaseSessionProviderSpec>

export interface BaseSessionProviderDefinition extends BaseSessionProviderSpec {
  harnessId: HarnessId
}

export const BASE_SESSION_PROVIDER_DEFINITIONS: readonly BaseSessionProviderDefinition[] = (
  Object.entries(BASE_SESSION_PROVIDERS) as Array<[HarnessId, BaseSessionProviderSpec]>
).map(([harnessId, spec]) => ({ harnessId, ...spec }))

export function baseSessionProviderId(harnessId: HarnessId): string {
  return BASE_SESSION_PROVIDERS[harnessId].id
}
