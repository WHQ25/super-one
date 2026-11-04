import type { HarnessId } from './agent-types'
import { HARNESS_CAPABILITIES } from './harness/harness-capabilities'

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
  acp: { id: 'acp-grok', name: 'Grok (Base)', config: { agentId: 'grok-build' } },
  opencode: { id: 'opencode-base', name: 'OpenCode (Base)', config: {} },
  cursor: { id: 'cursor-base', name: 'Cursor (Base)', config: {} },
  dsh: { id: 'dsh-base', name: 'DeepSeek (Base)', config: {} },
} satisfies Record<HarnessId, BaseSessionProviderSpec>

export interface BaseSessionProviderDefinition extends BaseSessionProviderSpec {
  harnessId: HarnessId
}

export const EXTRA_BASE_SESSION_PROVIDER_DEFINITIONS: readonly BaseSessionProviderDefinition[] = [
  { harnessId: 'acp', id: 'acp-antigravity', name: 'Antigravity (Base)', config: { agentId: 'antigravity' } },
]

export const BASE_SESSION_PROVIDER_DEFINITIONS: readonly BaseSessionProviderDefinition[] = [
  ...(Object.entries(BASE_SESSION_PROVIDERS) as Array<[HarnessId, BaseSessionProviderSpec]>).map(
    ([harnessId, spec]) => ({ harnessId, ...spec }),
  ),
  ...EXTRA_BASE_SESSION_PROVIDER_DEFINITIONS,
]

export function baseSessionProviderId(harnessId: HarnessId | string, acpAgentId?: string | null): string {
  if (harnessId === 'acp' && acpAgentId && acpAgentId.toLowerCase().includes('antigravity')) {
    return 'acp-antigravity'
  }
  const spec = (BASE_SESSION_PROVIDERS as Record<string, BaseSessionProviderSpec | undefined>)[harnessId]
  return spec ? spec.id : `${harnessId}-base`
}

export function isDefaultSessionProvider(row: { id: string; harnessId: HarnessId; isBase: boolean }): boolean {
  if (!row.isBase) return false
  if (row.harnessId === 'acp') {
    return row.id === 'acp-grok' || row.id === 'acp-antigravity' || row.id === 'acp-base'
  }
  return row.id === baseSessionProviderId(row.harnessId)
}

/**
 * How an agent picker names a provider row: a base row is its harness
 * ("Claude", not the stored "Claude (Base)"); a user-named row keeps its name.
 */
export function sessionProviderDisplayName(row: { harnessId: HarnessId; name: string; isBase: boolean }): string {
  return row.isBase ? HARNESS_CAPABILITIES[row.harnessId].displayName : row.name
}
