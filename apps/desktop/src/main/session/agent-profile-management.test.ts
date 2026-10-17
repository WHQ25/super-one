import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAgentProfileApprovalSchema } from './agent-profile-approval'
import { deleteManagedAgentProfile, getManagedAgentProfile, listManagedAgentProfiles, saveManagedAgentProfile } from './agent-profile-management'
import { getSessionProvider, sessionProviderStore, updateBaseProviderConfig } from './session-provider-repo'
import type { SaveManagedAgentProfile } from '@superone/shared/agent-profile-management'
import type { SessionManagerImpl } from './session-manager'

const state = vi.hoisted(() => ({
  enabled: true,
  db: null as unknown as Database.Database,
  preferences: {
    claude: { defaultModel: 'sonnet', defaultEffort: 'high', defaultPermissionMode: 'default', defaultSandboxMode: 'off' },
    codex: { defaultModel: 'gpt', defaultReasoningEffort: 'high', defaultPermissionPreset: 'read-only', defaultFastMode: false },
    acp: { selectedAgentId: 'agent-selected' }, cursor: {}, dsh: {}, opencode: {},
  },
  available: true,
}))
vi.mock('../database', () => ({
  getDb: () => state.db,
  getCachedHarnessResources: (harnessId: string) => ({ models: [{ id: harnessId === 'codex' ? 'gpt' : 'sonnet', name: 'Model', supportedEffortLevels: ['low', 'high'], supportedReasoningEfforts: [{ value: 'low' }, { value: 'high' }], defaultReasoningEffort: 'high' }] }),
}))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({ agentPreference: state.preferences, experimentalAgentProfilesEnabled: state.enabled, experimentalClaudeOpenAiChatEnabled: false }) }))
vi.mock('../agent/default-chat-provider', () => ({ defaultChatProviderId: () => null }))
vi.mock('../agent/claude-account-service', () => ({ listKnownAccounts: () => [] }))
vi.mock('../codex/codex-account-store', () => ({ codexAccountStore: () => ({ list: () => [] }) }))
vi.mock('../providers/credential-store', () => ({ getBinding: () => undefined, getCredentialDecrypted: () => undefined, listCredentials: () => [] }))
vi.mock('../providers/registry', () => ({ getPlatforms: () => [] }))
vi.mock('../harness/service', () => ({ getHarnessInstallation: () => ({ enabled: state.available, state: state.available ? 'ready' : 'disabled' }) }))
vi.mock('./harness-registry', () => ({ harnessRegistry: { get: () => ({ configSchema: { parse: (config: unknown) => config } }) } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  state.enabled = true
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  sessionProviderStore()
  state.db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_id TEXT)')
  ensureAgentProfileApprovalSchema(state.db)
  state.available = true
  state.preferences.claude.defaultEffort = 'high'
})
afterEach(() => state.db.close())

async function proposal(sourceId = 'claude-base'): Promise<SaveManagedAgentProfile> {
  const detail = await getManagedAgentProfile(sourceId)
  return { sourceId, version: detail.version, reviewToken: detail.reviewToken, draft: { name: 'Reviewer', description: 'Review changes.', instructions: 'Never edit files.' } }
}

describe('Agent Profile settings management', () => {
  it('rejects every management operation while disabled and preserves saved data', async () => {
    const input = await proposal()
    const saved = await saveManagedAgentProfile(input)
    const detail = await getManagedAgentProfile(saved.id)
    const count = listManagedAgentProfiles().length
    state.enabled = false
    expect(() => listManagedAgentProfiles()).toThrow(/experimental/)
    await expect(getManagedAgentProfile(saved.id)).rejects.toThrow(/experimental/)
    await expect(saveManagedAgentProfile(input)).rejects.toThrow(/experimental/)
    expect(() => deleteManagedAgentProfile({ id: saved.id, version: detail.version }, null)).toThrow(/experimental/)
    expect(getSessionProvider(saved.id)).toBeTruthy()
    state.enabled = true
    expect(listManagedAgentProfiles()).toHaveLength(count)
  })

  it('rejects a save when disabled during asynchronous catalog validation', async () => {
    const input = await proposal()
    const pending = saveManagedAgentProfile(input)
    state.enabled = false
    await expect(pending).rejects.toThrow(/experimental/)
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })

  it('rejects a save reviewed before the experiment was disabled', async () => {
    const input = await proposal()
    state.enabled = false
    await expect(saveManagedAgentProfile(input)).rejects.toThrow(/experimental/)
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })

  it('lists one dynamic default per harness, including disabled harnesses', async () => {
    state.available = false
    expect(listManagedAgentProfiles()).toHaveLength(6)
    expect(listManagedAgentProfiles().every((profile) => profile.followsDefaults && !profile.available)).toBe(true)
    const first = await getManagedAgentProfile('claude-base')
    state.preferences.claude.defaultEffort = 'low'
    const next = await getManagedAgentProfile('claude-base')
    expect(next.id).toBe(first.id)
    expect(next.agent.defaultConfig.effort).toBe('low')
    expect(next.reviewToken).not.toBe(first.reviewToken)
  })

  it('creates a validated Profile and commits its exact collaboration approval', async () => {
    const input = await proposal()
    const saved = await saveManagedAgentProfile(input)
    const detail = await getManagedAgentProfile(saved.id)
    expect(detail).toMatchObject({ name: 'Reviewer', approved: true, followsDefaults: false, spec: { instructions: 'Never edit files.' } })
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 1 })
  })

  it('preserves native read-only Codex defaults in the saved configuration', async () => {
    const saved = await saveManagedAgentProfile(await proposal('codex-base'))
    expect(await getManagedAgentProfile(saved.id)).toMatchObject({ approved: true, agent: { defaultConfig: { codexPermissionPreset: 'read-only' } } })
  })

  it('rolls back the Profile write if approval cannot be persisted', async () => {
    const input = await proposal()
    state.db.exec("CREATE TRIGGER fail_approval BEFORE INSERT ON agent_profile_approvals BEGIN SELECT RAISE(ABORT, 'Approval unavailable'); END")
    await expect(saveManagedAgentProfile(input)).rejects.toThrow('Approval unavailable')
    expect(listManagedAgentProfiles().every((profile) => profile.followsDefaults)).toBe(true)
  })

  it('pins a new ACP Profile to the effective agent rather than the seeded agent', async () => {
    const saved = await saveManagedAgentProfile(await proposal('acp-base'))
    expect(getSessionProvider(saved.id)?.config).toMatchObject({ agentId: 'agent-selected' })
  })

  it('updates instructions and reapproves the new configuration', async () => {
    const saved = await saveManagedAgentProfile(await proposal())
    const input = await proposal(saved.id)
    input.id = saved.id
    input.draft.instructions = 'Review security too.'
    await saveManagedAgentProfile(input)
    expect(await getManagedAgentProfile(saved.id)).toMatchObject({ approved: true, spec: { instructions: 'Review security too.' } })
  })

  it('rejects catalog-invalid runtime values without saving or approving', async () => {
    const input = await proposal()
    input.draft.effort = 'ultra'
    await expect(saveManagedAgentProfile(input)).rejects.toThrow(/not supported/)
    expect(listManagedAgentProfiles().every((profile) => profile.followsDefaults)).toBe(true)
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })

  it.each(['before saving', 'during validation'])('rejects inherited-default changes %s without a partial write', async (when) => {
    const input = await proposal()
    if (when === 'before saving') state.preferences.claude.defaultEffort = 'low'
    const pending = saveManagedAgentProfile(input)
    if (when === 'during validation') { await Promise.resolve(); state.preferences.claude.defaultEffort = 'low' }
    await expect(pending).rejects.toThrow(/changed/)
    expect(listManagedAgentProfiles().every((profile) => profile.followsDefaults)).toBe(true)
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })

  it('does not overwrite a Profile edited after the form was opened', async () => {
    const saved = await saveManagedAgentProfile(await proposal())
    const input = await proposal(saved.id)
    input.id = saved.id
    const row = getSessionProvider(saved.id)!
    sessionProviderStore().profiles.update(row.id, { name: 'Newer name', config: row.config as { profile: unknown } }, row)
    await expect(saveManagedAgentProfile(input)).rejects.toThrow(/changed/)
    expect(getSessionProvider(saved.id)?.name).toBe('Newer name')
  })

  it('rejects default Profile edits and deletion', async () => {
    const input = await proposal()
    await expect(saveManagedAgentProfile({ ...input, id: input.sourceId })).rejects.toThrow(/cannot be edited/)
    expect(() => deleteManagedAgentProfile({ id: input.sourceId, version: input.version }, null)).toThrow(/cannot be deleted/)
  })

  it('deletes approval and rebinds both stored and live sessions', async () => {
    const saved = await saveManagedAgentProfile(await proposal())
    const detail = await getManagedAgentProfile(saved.id)
    state.db.prepare('INSERT INTO sessions VALUES (?, ?)').run('session', saved.id)
    const host = { rebindProviderSessions: vi.fn() }
    deleteManagedAgentProfile({ id: saved.id, version: detail.version }, host as unknown as SessionManagerImpl)
    expect(getSessionProvider(saved.id)).toBeNull()
    expect(state.db.prepare('SELECT * FROM agent_profile_approvals').all()).toEqual([])
    expect(state.db.prepare('SELECT provider_id FROM sessions').get()).toEqual({ provider_id: 'claude-base' })
    expect(host.rebindProviderSessions).toHaveBeenCalledWith(saved.id, 'claude-base')
  })

  it('keeps inherited connection secrets out of management data', async () => {
    updateBaseProviderConfig('claude', { apiKey: 'private-profile-secret' })
    const detail = await getManagedAgentProfile('claude-base')
    expect(JSON.stringify(detail)).not.toContain('private-profile-secret')
    expect(JSON.stringify(listManagedAgentProfiles())).not.toContain('private-profile-secret')
  })
})
