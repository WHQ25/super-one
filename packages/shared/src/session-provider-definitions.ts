import type { HarnessId } from './agent-types'
import { resolveLegacyHarnessId } from './harness/acp-brand'
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
  'acp-grok': { id: 'acp-grok', name: 'Grok (Base)', config: { agentId: 'grok-build' } },
  'acp-antigravity': { id: 'acp-antigravity', name: 'Antigravity (Base)', config: { agentId: 'antigravity' } },
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

export function baseSessionProviderId(harnessId: HarnessId | string, acpAgentId?: string | null): string {
  const resolved = resolveLegacyHarnessId(String(harnessId), { acpAgentId, providerId: harnessId === 'acp' ? null : String(harnessId) })
    ?? (typeof harnessId === 'string' ? null : harnessId)
  const spec = resolved ? BASE_SESSION_PROVIDERS[resolved] : undefined
  return spec ? spec.id : `${harnessId}-base`
}

export function isDefaultSessionProvider(row: { id: string; harnessId: string; isBase: boolean }): boolean {
  if (!row.isBase) return false
  const resolved = resolveLegacyHarnessId(row.harnessId, { providerId: row.id })
  if (!resolved) return false
  if (row.id === 'acp-base') return resolved === 'acp-grok'
  return row.id === BASE_SESSION_PROVIDERS[resolved].id
}

/**
 * How an agent picker names a provider row: a base row is its harness
 * ("Claude", not the stored "Claude (Base)"); a user-named row keeps its name.
 */
export function sessionProviderDisplayName(row: { harnessId: HarnessId; name: string; isBase: boolean }): string {
  return row.isBase ? HARNESS_CAPABILITIES[row.harnessId].displayName : row.name
}
