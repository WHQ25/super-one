import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionProviderStore } from '@superone/runtime/session'
import type { SessionAgentProfile, SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import type { Credential, Platform } from '@superone/shared/platform-registry'
const state = vi.hoisted(() => ({ enabled: true, db: null as unknown as Database.Database, credentials: [] as Credential[], platforms: [] as Platform[] }))
vi.mock('../database', () => ({ getDb: () => state.db }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({ experimentalAgentProfilesEnabled: state.enabled, experimentalClaudeOpenAiChatEnabled: false }) }))
vi.mock('../providers/credential-store', () => ({ getBinding: () => undefined, getCredentialDecrypted: (id: string) => state.credentials.find((c) => c.id === id) }))
vi.mock('../providers/registry', () => ({ getPlatforms: () => state.platforms }))
vi.mock('./session-provider-repo', () => ({ getSessionProvider: (id: string) => createSessionProviderStore(state.db).get(id) }))
import { approveAgentProfile, configFingerprint, ensureAgentProfileApprovalSchema, isAgentProfileApproved, isPreapprovedProfileLaunch, selectedApprovalProvider } from './agent-profile-approval'
import { resolveChatService } from '../providers/resolver'
let directory: string
const config = { model: 'gpt', effort: 'high', permissionMode: 'default' as const, sandboxMode: 'on' as const, apiProviderId: 'codex-account:work' }
const profile: SessionAgentProfile = { id: 'implementer', harnessId: 'codex', name: 'Implementer', description: 'Implement changes', models: [], efforts: [], apiProviders: [], defaultConfig: config }
function row() { return createSessionProviderStore(state.db).get('implementer')! }
function apiFixture() {
  const credential: Credential = { id: 'api-work', name: 'Work', platformId: 'openai', planId: 'api', secret: 'private-test-key', notes: '', sortOrder: 0 }
  state.credentials = [credential]
  state.platforms = [{ id: 'openai', name: 'OpenAI', brand: 'openai', plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints: [{ id: 'openai', protocols: ['openai-chat'], baseUrl: 'https://api.openai.com/v1', defaults: { modelMapping: { default: { id: 'gpt' } } } }] }] }]
  const selected = { ...profile, defaultConfig: { ...config, apiProviderId: credential.id }, apiProviders: [{ id: credential.id, name: 'OpenAI · Work', brand: 'openai', modelEnv: { default: { id: 'gpt' } } }] }
  return { credential, selected }
}
beforeEach(() => {
  state.enabled = true
  state.credentials = []
  state.platforms = []
  directory = mkdtempSync(join(tmpdir(), 'profile-approval-'))
  state.db = new Database(join(directory, 'profiles.db'))
  state.db.pragma('foreign_keys = ON')
  createSessionProviderStore(state.db).profiles.create({ id: 'implementer', name: 'Implementer', harnessId: 'codex', config: { profile: { version: 1, identity: { name: 'Implementer', description: 'Implement changes' }, instructions: 'Make scoped changes.' } } })
  ensureAgentProfileApprovalSchema(state.db)
})
afterEach(() => { state.db.close(); rmSync(directory, { recursive: true, force: true }) })
describe('durable Profile approval', () => {
  it('does not authorize default or saved Profiles when the experiment is off', () => {
    approveAgentProfile(row(), config)
    expect(isAgentProfileApproved(profile)).toBe(true)
    state.enabled = false
    expect(isAgentProfileApproved(profile)).toBe(false)
    expect(isAgentProfileApproved({ ...profile, id: 'codex-base' })).toBe(false)
    state.enabled = true
    expect(isAgentProfileApproved(profile)).toBe(true)
  })

  it('preserves the reviewed legacy ACP identity across reopen and delayed approval writes', () => {
    const legacy = createSessionProviderStore(state.db).profiles.create({ id: 'legacy-acp', harnessId: 'acp', name: 'Legacy ACP', config: { profile: { version: 1, identity: { name: 'Legacy ACP', description: 'Implement tasks.' }, runtime: { model: 'shared-model' } } } })
    const selected: SessionAgentProfile = { ...profile, id: legacy.id, harnessId: 'acp', acpAgentId: 'agent-before', defaultConfig: { model: 'shared-model', permissionMode: 'default' } }
    const reviewed = selectedApprovalProvider(selected)
    approveAgentProfile(legacy, selected.defaultConfig, reviewed)
    const path = state.db.name
    state.db.close(); state.db = new Database(path)
    expect(isAgentProfileApproved(selected)).toBe(true)
    const after = { ...selected, acpAgentId: 'agent-after' }
    expect(isAgentProfileApproved(after)).toBe(false)
    approveAgentProfile(legacy, selected.defaultConfig, reviewed)
    expect(isAgentProfileApproved(after)).toBe(false)
    expect(isAgentProfileApproved({ ...selected, acpAgentId: undefined })).toBe(false)
  })
  it('survives database reopen, but not definition or final-default mutation', () => {
    expect(isAgentProfileApproved(profile)).toBe(false)
    approveAgentProfile(row(), config)
    const path = state.db.name
    state.db.close(); state.db = new Database(path)
    expect(isAgentProfileApproved(profile)).toBe(true)
    for (const patch of [{ model: 'different' }, { effort: 'low' }, { apiProviderId: 'codex-account:personal' }, { permissionMode: 'bypassPermissions' as const }, { sandboxMode: 'off' as const }]) {
      expect(isAgentProfileApproved({ ...profile, defaultConfig: { ...config, ...patch } })).toBe(false)
    }
    const existing = row()
    createSessionProviderStore(state.db).profiles.update(existing.id, { config: { profile: { version: 1, identity: { name: 'Implementer', description: 'Implement changes' }, instructions: 'Changed instructions.' } } }, existing)
    expect(isAgentProfileApproved(profile)).toBe(false)
  })
  it('invalidates approval when a selected provider remaps its models under the same id', () => {
    const provider = { id: config.apiProviderId, name: 'Work', modelEnv: { default: { id: 'old-model' } } }
    const selected = { ...profile, apiProviders: [provider] }
    approveAgentProfile(row(), config, selectedApprovalProvider(selected))
    expect(isAgentProfileApproved(selected)).toBe(true)
    expect(isAgentProfileApproved({ ...selected, apiProviders: [{ ...provider, modelEnv: { default: { id: 'new-model' } } }] })).toBe(false)
  })
  it('invalidates approval when the effective endpoint changes under identical provider display metadata', () => {
    const { credential, selected } = apiFixture()
    approveAgentProfile(row(), selected.defaultConfig, selectedApprovalProvider(selected))
    expect(isAgentProfileApproved(selected)).toBe(true)
    expect(resolveChatService('codex', credential.id)?.baseUrl).toBe('https://api.openai.com/v1')
    credential.overrides = { openai: { baseUrl: 'https://changed-review.invalid/v1' } }
    expect(resolveChatService('codex', credential.id)?.baseUrl).toBe('https://changed-review.invalid/v1')
    expect(isAgentProfileApproved(selected)).toBe(false)
    expect(JSON.stringify(state.db.prepare('SELECT * FROM agent_profile_approvals').all())).not.toMatch(/private-test-key|api\.openai\.com/)
  })
  it.each(['environment', 'credential'] as const)('binds approval to effective provider %s settings without exposing secrets', (kind) => {
    const { credential, selected } = apiFixture()
    const reviewed = selectedApprovalProvider(selected)
    approveAgentProfile(row(), selected.defaultConfig, reviewed)
    expect(isAgentProfileApproved(selected)).toBe(true)
    if (kind === 'environment') credential.overrides = { openai: { extraEnv: { OPENAI_BASE_URL: 'https://other.invalid', PRIVATE_TOKEN: 'hidden-env-value' } } }
    else credential.secret = 'replacement-secret'
    expect(isAgentProfileApproved(selected)).toBe(false)
    // A delayed write must store only the reviewed snapshot, never reapprove new settings.
    approveAgentProfile(row(), selected.defaultConfig, reviewed)
    expect(isAgentProfileApproved(selected)).toBe(false)
    expect(JSON.stringify(state.db.prepare('SELECT * FROM agent_profile_approvals').all())).not.toMatch(/private-test-key|replacement-secret|hidden-env-value|other\.invalid/)
  })
  it('revokes approval on deletion and never revives it by recreating the same id', () => {
    approveAgentProfile(row(), config)
    createSessionProviderStore(state.db).profiles.delete('implementer', row())
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
    createSessionProviderStore(state.db).profiles.create({ id: 'implementer', name: 'Implementer', harnessId: 'codex', config: { profile: { version: 1, identity: { name: 'Implementer', description: 'Implement changes' } } } })
    expect(isAgentProfileApproved(profile)).toBe(false)
  })
  it('does not approve an unresolved implicit model or arbitrary runtime properties', () => {
    approveAgentProfile(row(), { permissionMode: 'default' })
    expect(isAgentProfileApproved({ ...profile, defaultConfig: { permissionMode: 'default' } })).toBe(false)
    approveAgentProfile(row(), config)
    const launch: SessionAgentLaunchProposal = { launchId: 'start', mode: 'spawn', agentId: profile.id, name: 'Worker', role: 'Implementer', summary: 'Build', config: { ...config, cwd: '/project' } }
    expect(isPreapprovedProfileLaunch(profile, launch, '/project')).toBe(true)
    expect(isPreapprovedProfileLaunch(profile, { ...launch, config: { ...launch.config, extraPrivileges: true } as typeof launch.config }, '/project')).toBe(false)
    expect(isPreapprovedProfileLaunch(profile, { ...launch, mode: 'link' }, '/project')).toBe(false)
    expect(configFingerprint({ a: 1, b: { z: false, y: 2 } })).toBe(configFingerprint({ b: { y: 2, z: false }, a: 1 }))
  })
})
