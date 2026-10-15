/**
 * Agent profile writes on this desktop: the one path that changes a
 * `config.profile` row, called by the agent_profile_* tools once the user has
 * confirmed the exact change. RPC and IPC provider writes refuse profile rows
 * (`session-provider-store.ts`), so every profile write passes these checks.
 */

import type { HarnessId } from '@superone/shared/agent-types'
import { readAgentProfile, validateAgentProfileRuntime, type AgentProfileCatalog } from '@superone/shared/agent-profile'
import type { AgentProfileListChoice } from '@superone/shared/agent-profile-options'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import log from '../logger'
import { profileResources, resolveAcpAgentId } from './agent-profiles'
import { deleteProviderRow, listSessionProviders, sessionProviderStore } from './session-provider-repo'
import type { SessionProvider } from './types'

export function harnessDisplayName(harnessId: HarnessId): string {
  return HARNESS_CAPABILITIES[harnessId]?.displayName ?? harnessId
}

/** Another row already answering to this (case-insensitive) name. */
export function agentProfileNameTaken(name: string, exceptId?: string): SessionProvider | undefined {
  const key = name.trim().toLowerCase()
  return listSessionProviders().find((row) => row.id !== exceptId && row.name.trim().toLowerCase() === key)
}

/** dsh presets come from its runtime, not the resource cache; undefined when it cannot list them now. */
async function deepseekPresetChoices(): Promise<AgentProfileListChoice[] | undefined> {
  try {
    const { getDeepseekRuntime } = await import('../deepseek/deepseek-runtime-host')
    const { listDeepseekPresets } = await import('@superone/deepseek/presets')
    const presets = await listDeepseekPresets((await getDeepseekRuntime()).context)
    return presets.filter((preset) => !preset.broken).map((preset) => ({ value: preset.id, label: preset.name || preset.id }))
  } catch (err) {
    log.warn('[agent-profile] deepseek presets unavailable: %s', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

/** Everything a profile on this row is checked against, harness-wide lists included. */
export async function agentProfileCatalog(row: SessionProvider): Promise<AgentProfileCatalog> {
  const agentPreset = row.harnessId === 'dsh' ? await deepseekPresetChoices() : undefined
  return profileResources(row, {
    acpAgentId: row.harnessId === 'acp' ? resolveAcpAgentId(row) : null,
    ...(agentPreset ? { lists: { agentPreset } } : {}),
  }).catalog
}

/** The row's profile runtime checked against `catalog`; null when it fits. */
export function agentProfileCatalogError(row: SessionProvider, catalog: AgentProfileCatalog): string | null {
  const runtime = readAgentProfile(row.config)?.runtime
  const errors = validateAgentProfileRuntime(runtime, catalog, { id: row.harnessId, name: harnessDisplayName(row.harnessId) })
  return errors.length ? errors.join(' ') : null
}

async function assertCatalogFits(row: SessionProvider): Promise<void> {
  const invalid = agentProfileCatalogError(row, await agentProfileCatalog(row))
  if (invalid) throw new Error(invalid)
}

/** Checked in the same tick as the write that follows it. */
function assertNameFree(row: SessionProvider): void {
  const taken = agentProfileNameTaken(row.name, row.id || undefined)
  if (taken) throw new Error(`An agent named "${row.name}" already exists (${taken.id}).`)
}

export async function createAgentProfile(input: { harnessId: HarnessId; name: string; config: { profile: unknown } }): Promise<SessionProvider> {
  const draft: SessionProvider = { id: '', harnessId: input.harnessId, name: input.name, isBase: false, config: input.config, createdAt: 0, updatedAt: 0 }
  await assertCatalogFits(draft)
  assertNameFree(draft)
  return sessionProviderStore().profiles.create(input)
}

/** Fails, writing nothing, when the row no longer matches `expected` (the row the user confirmed against). */
export async function updateAgentProfile(
  expected: SessionProvider,
  patch: { name: string; config: { profile: unknown } },
): Promise<SessionProvider> {
  const next = { ...expected, ...patch }
  await assertCatalogFits(next)
  assertNameFree(next)
  return sessionProviderStore().profiles.update(expected.id, patch, expected)
}

/**
 * Delete a profile; its sessions, stored and live, move to the harness's
 * built-in row, so no later state save writes the deleted id back.
 */
export function deleteAgentProfile(
  expected: SessionProvider,
  liveSessions: { rebindProviderSessions?(fromProviderId: string, toProviderId: string): void } | null,
): boolean {
  const deleted = deleteProviderRow(expected, () => sessionProviderStore().profiles.delete(expected.id, expected))
  if (deleted) liveSessions?.rebindProviderSessions?.(expected.id, `${expected.harnessId}-base`)
  return deleted
}
