import { ensureAgentProfileApprovalSchema, isAgentProfileApproved } from '../session/agent-profile-approval'
import { agentProfileLaunchConfig } from '../session/agent-profiles'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decode as toonDecode } from '@toon-format/toon'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { SessionProvider } from '../session/types'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const state = vi.hoisted(() => ({
  rows: new Map<string, SessionProvider>(),
  nextId: 1,
  enabled: true,
  db: null as unknown as Database.Database,
  launchDefaults: {} as Record<string, unknown>,
  acpAgentId: 'grok-build' as string | null,
}))

vi.mock('../database', () => ({ getDb: () => state.db }))
vi.mock('../providers/credential-store', () => ({ getBinding: () => undefined, getCredentialDecrypted: () => undefined }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({ experimentalAgentProfilesEnabled: state.enabled, experimentalClaudeOpenAiChatEnabled: false }) }))

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

/** Same contract as the runtime store's profile writer: `expected` must still match the row. */
function assertUnchanged(id: string, expected: SessionProvider) {
  const current = state.rows.get(id)
  if (!current) throw Object.assign(new Error(`Provider not found: ${id}`), { code: 'not_found' })
  if (current.name !== expected.name || JSON.stringify(current.config) !== JSON.stringify(expected.config)) {
    throw Object.assign(new Error(`Agent profile ${id} changed while waiting for confirmation.`), { code: 'aborted' })
  }
}

const profiles = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../session/session-provider-repo', () => ({
  listSessionProviders: () => [...state.rows.values()],
  getSessionProvider: (id: string) => state.rows.get(id) ?? null,
  getBaseProvider: (harnessId: string) => state.rows.get(`${harnessId}-base`)!,
  sessionProviderStore: () => ({ profiles }),
  deleteProviderRow: (_row: SessionProvider, remove: () => boolean) => remove(),
}))

function implementProfileWriter() {
  profiles.create.mockImplementation((input: { harnessId: SessionProvider['harnessId']; name: string; config: unknown }) => {
    const row: SessionProvider = { id: `${input.harnessId}-p${state.nextId++}`, isBase: false, createdAt: 0, updatedAt: 0, ...input }
    state.rows.set(row.id, row)
    state.db.prepare('INSERT INTO session_providers (id) VALUES (?)').run(row.id)
    return row
  })
  profiles.update.mockImplementation((id: string, patch: { name?: string; config?: unknown }, expected: SessionProvider) => {
    assertUnchanged(id, expected)
    const row = { ...state.rows.get(id)!, ...patch }
    state.rows.set(id, row)
    return row
  })
  profiles.delete.mockImplementation((id: string, expected: SessionProvider) => {
    assertUnchanged(id, expected)
    return state.rows.delete(id)
  })
}

const CLAUDE_MODELS = [
  { id: 'sonnet', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
  { id: 'opus', name: 'Opus', supportedEffortLevels: ['low', 'high', 'xhigh', 'max'] },
]
const CODEX_MODELS = [
  { id: 'gpt-5.6', name: 'GPT-5.6', supportedReasoningEfforts: [{ value: 'medium' }], serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] },
]

const CLAUDE_AGENT = {
  id: 'claude-base', name: 'Claude', harnessId: 'claude', models: [], efforts: [], apiProviders: [],
  defaultConfig: { model: 'sonnet', effort: 'high', permissionMode: 'default' },
}

vi.mock('../session/agent-profiles', () => ({
  isProviderUsable: () => true,
  agentProfileLaunchConfig: (row: SessionProvider) => {
    const config = row.config as { profile?: { runtime?: Record<string, unknown> } }
    return { model: row.harnessId === 'codex' ? 'gpt-5.6' : 'sonnet', effort: 'high', permissionMode: 'default', ...state.launchDefaults, ...config.profile?.runtime }
  },
  listSessionAgentProfiles: () => [CLAUDE_AGENT],
  resolveAcpAgentId: (row: SessionProvider) => (row.config as { agentId?: string }).agentId ?? state.acpAgentId,
  profileResources: (row: SessionProvider) => {
    const models = row.harnessId === 'claude' ? CLAUDE_MODELS : row.harnessId === 'codex' ? CODEX_MODELS : row.harnessId === 'acp' ? GROK_MODELS : []
    const host = { lists: { mode: [] } }
    return { models, efforts: [], catalog: { models, efforts: row.harnessId === 'acp' ? ['low', 'high'] : undefined, host }, defaultConfig: { model: models[0]?.id } }
  },
}))

import { _resetAgentProfileConfirmsForTests, resolveAgentProfileConfirm } from './agent-profile-confirm'
import { agentProfileApplyHandler, agentProfileDeleteHandler, agentProfileListHandler } from './agent-profile-tools'

const REVIEWER_PROFILE = {
  version: 1,
  identity: { name: 'Reviewer', description: 'Reviews diffs without editing.' },
  instructions: 'Never edit files.',
  runtime: { model: 'opus', effort: 'high' },
}

const GROK_MODELS = [{ id: 'grok-4', name: 'Grok 4', contextWindows: [256_000, 1_000_000] }]

function seed() {
  state.rows.clear()
  state.nextId = 1
  for (const harnessId of ['claude', 'codex', 'acp'] as const) {
    state.rows.set(`${harnessId}-base`, { id: `${harnessId}-base`, harnessId, name: harnessId, isBase: true, config: {}, createdAt: 0, updatedAt: 0 })
  }
  state.rows.set('claude-reviewer', {
    id: 'claude-reviewer', harnessId: 'claude', name: 'Reviewer', isBase: false,
    config: { profile: REVIEWER_PROFILE }, createdAt: 0, updatedAt: 0,
  })
}

function makeDeps(signal?: AbortSignal) {
  const requests: PermissionRequest[] = []
  const rebindProviderSessions = vi.fn()
  const deps: BuiltInSuperoneToolDeps = {
    notifyDevAppReady: vi.fn(),
    sessionId: 'sess-1',
    sessionHost: {
      rebindProviderSessions,
      getSession: () => ({
        setTitle: vi.fn(),
        emitHostEvent: (event: { type: string; request?: PermissionRequest }) => {
          if (event.type === 'permission_request' && event.request) requests.push(event.request)
        },
      }),
    },
    applyAppSettings: vi.fn(),
    ...(signal ? { signal } : {}),
  } as unknown as BuiltInSuperoneToolDeps
  return { deps, requests, rebindProviderSessions }
}

function parse(result: { content: Array<{ text: string }>; isError?: boolean }) {
  const text = result.content[0]?.text ?? ''
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { parsed = toonDecode(text) as Record<string, unknown> }
  return { parsed, isError: !!result.isError }
}

/** Run a write and answer its confirm card as the user would. */
async function answer<T>(run: Promise<T>, requests: PermissionRequest[], action: 'accept' | 'decline', content?: Record<string, unknown>) {
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  resolveAgentProfileConfirm(requests[0]!.requestId, action, content)
  return run
}

beforeEach(() => {
  state.enabled = true
  state.acpAgentId = 'grok-build'
  state.launchDefaults = {}
  state.db = new Database(':memory:')
  state.db.exec('CREATE TABLE session_providers (id TEXT PRIMARY KEY)')
  ensureAgentProfileApprovalSchema(state.db)
  seed()
  for (const id of state.rows.keys()) state.db.prepare('INSERT INTO session_providers (id) VALUES (?)').run(id)
  vi.clearAllMocks()
  implementProfileWriter()
  _resetAgentProfileConfirmsForTests()
})

afterEach(() => state.db.close())

describe('agent_profile_list', () => {
  it('lists only what picks a row; runtime waits for the id', async () => {
    const { parsed } = parse(await agentProfileListHandler({}))
    expect(parsed.count).toBe(4)
    expect(parsed.profiles).toEqual(expect.arrayContaining([
      { id: 'claude-base', name: 'claude', harness: 'claude', base: true, followsDefaults: true, description: 'Claude with the user\'s default configuration.' },
      { id: 'claude-reviewer', name: 'Reviewer', harness: 'claude', base: false, description: 'Reviews diffs without editing.' },
    ]))
  })

  it('returns full instructions and the harness options for one id', async () => {
    const { parsed } = parse(await agentProfileListHandler({ id: 'claude-reviewer' }))
    expect(parsed.profile).toMatchObject({ instructions: 'Never edit files.', runtime: { model: 'opus', effort: 'high' } })
    expect(parsed.available).toEqual({
      permissionModes: ['default', 'plan', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions'],
      keys: ['ultracode'],
      harness: {},
      models: [
        { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'], options: { ultracode: null } },
        { id: 'opus', name: 'Opus', efforts: ['low', 'high', 'xhigh', 'max'], options: { ultracode: 'boolean' } },
      ],
    })
  })

  it('points an unknown id back at the list', async () => {
    const { parsed, isError } = parse(await agentProfileListHandler({ id: 'nope' }))
    expect(isError).toBe(true)
    expect(parsed.message).toMatch(/agent_profile_list without id/)
  })

  it('exposes the same current effective settings in the default Profile detail', async () => {
    state.launchDefaults = { sandboxMode: 'on', apiProviderId: 'work-account', permissionMode: 'bypassPermissions' }
    const first = parse(await agentProfileListHandler({ id: 'claude-base' })).parsed
    expect(first.profile).toMatchObject({ base: true, followsDefaults: true })
    expect(first.launchDefaults).toEqual(agentProfileLaunchConfig(state.rows.get('claude-base')!))
    state.launchDefaults = { sandboxMode: 'off', apiProviderId: 'personal-account' }
    expect(parse(await agentProfileListHandler({ id: 'claude-base' })).parsed.launchDefaults).toMatchObject(state.launchDefaults)
  })
})

describe('agent_profile_apply create', () => {
  it('shows the full config on the confirm card and writes only after approval', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Architect', description: 'Plans large refactors.',
      instructions: 'Write a plan first.', model: 'opus', effort: 'max', options: { ultracode: true },
    }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(profiles.create).not.toHaveBeenCalled()
    expect(requests[0]).toMatchObject({
      requestKind: 'agent_profile_confirm',
      allowAlwaysAllow: false,
      agentProfileConfirm: {
        operation: 'create',
        profiles: [{
          harnessId: 'claude', name: 'Architect', description: 'Plans large refactors.', instructions: 'Write a plan first.',
          model: 'opus', modelName: 'Opus', effort: 'max', options: { ultracode: 'on' },
        }],
      },
    })
    const { parsed } = parse(await answer(run, requests, 'accept'))
    expect(parsed).toMatchObject({ status: 'ok', action: 'create', profile: { name: 'Architect', runtime: { model: 'opus', options: { ultracode: true } } } })
    expect(profiles.create).toHaveBeenCalledWith({
      harnessId: 'claude',
      name: 'Architect',
      config: {
        profile: {
          version: 1,
          identity: { name: 'Architect', description: 'Plans large refactors.' },
          instructions: 'Write a plan first.',
          runtime: { model: 'opus', effort: 'max', options: { ultracode: true } },
        },
      },
    })
  })

  it('rejects an unsupported combination by name before asking the user', async () => {
    const { deps, requests } = makeDeps()
    const { parsed, isError } = parse(await agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Ultra', description: 'x', model: 'sonnet', options: { ultracode: true },
    }, deps))
    expect(isError).toBe(true)
    expect(parsed.message).toBe('options.ultracode is not supported by Claude model "sonnet".')
    expect(requests).toHaveLength(0)
  })

  it('refuses another harness\'s option by name', async () => {
    const { deps, requests } = makeDeps()
    const { parsed, isError } = parse(await agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Fast', description: 'x', model: 'opus', options: { fastMode: true },
    }, deps))
    expect(isError).toBe(true)
    expect(parsed.message).toBe('runtime.options.fastMode is not a claude setting (claude has: ultracode).')
    expect(requests).toHaveLength(0)
  })

  it('shows each harness only its own option rows, with the ones a model lacks as unsupported', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({
      action: 'create', harnessId: 'acp', name: 'Scout', description: 'Explores.', model: 'grok-4', options: { contextWindow: 1_000_000 },
    }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm?.profiles[0]).toMatchObject({
      harnessId: 'acp', model: 'grok-4', options: { contextWindow: '1M' }, unsupported: ['mode'],
    })
    await answer(run, requests, 'decline')
  })

  it('pins the ACP agent the user runs today', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'acp', name: 'Groker', description: 'Grok helper.' }, deps)
    await answer(run, requests, 'accept')
    expect(requests[0]?.agentProfileConfirm?.profiles[0]).toMatchObject({ acpAgentId: 'grok-build' })
    expect(profiles.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ agentId: 'grok-build' }),
    }))
  })

  it('requires description and a unique name', async () => {
    const { deps } = makeDeps()
    expect(parse(await agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'X' }, deps)).parsed.message)
      .toMatch(/name and description/)
    expect(parse(await agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'reviewer', description: 'd' }, deps)).parsed.message)
      .toMatch(/already exists \(claude-reviewer\)/)
  })

  it('saves a permission mode the harness offers and refuses one it does not', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'Planner', description: 'Plans.', permissionMode: 'plan' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm?.profiles[0]).toMatchObject({ permissionMode: 'plan' })
    await answer(run, requests, 'accept')
    expect(profiles.create).toHaveBeenCalledWith(expect.objectContaining({
      config: { profile: expect.objectContaining({ runtime: { permissionMode: 'plan' } }) },
    }))

    const refused = parse(await agentProfileApplyHandler({ action: 'create', harnessId: 'codex', name: 'Planner 2', description: 'Plans.', permissionMode: 'plan' }, deps))
    expect(refused.isError).toBe(true)
    expect(refused.parsed.message).toBe('runtime.permissionMode "plan" is not a codex mode (codex has: default, auto, bypassPermissions).')
  })

  it('hands the card the proposal, the harness agent and only the catalog fields option rows read', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Architect', description: 'Plans refactors.', model: 'opus', options: { ultracode: true },
    }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm?.editor).toEqual({
      draft: { name: 'Architect', description: 'Plans refactors.', model: 'opus', options: { ultracode: true } },
      agent: CLAUDE_AGENT,
      catalog: {
        models: CLAUDE_MODELS.map(({ id, supportedEffortLevels }) => ({ id, supportedEffortLevels })),
        host: { lists: { mode: [] } },
      },
    })
    await answer(run, requests, 'decline')
  })

  it('saves the user\'s edits from the card and tells the agent which fields they changed', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Architect', description: 'Plans refactors.', model: 'opus', effort: 'max',
    }, deps)
    const draft = {
      name: 'Lead Architect', description: 'Plans refactors.', instructions: 'Plan first.',
      model: 'sonnet', effort: 'medium', permissionMode: 'plan',
    }
    const { parsed } = parse(await answer(run, requests, 'accept', { agentProfileDraftJson: JSON.stringify(draft) }))
    expect(parsed).toMatchObject({
      status: 'ok',
      profile: { name: 'Lead Architect' },
      editedByUser: ['name', 'instructions', 'model', 'effort', 'permissionMode'],
    })
    expect(profiles.create).toHaveBeenCalledWith({
      harnessId: 'claude',
      name: 'Lead Architect',
      config: {
        profile: {
          version: 1,
          identity: { name: 'Lead Architect', description: 'Plans refactors.' },
          instructions: 'Plan first.',
          runtime: { model: 'sonnet', effort: 'medium', permissionMode: 'plan' },
        },
      },
    })
  })

  it('writes nothing when the user\'s edits do not fit the harness', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'Architect', description: 'Plans.' }, deps)
    const draft = { name: 'Architect', description: 'Plans.', model: 'sonnet', effort: 'max' }
    const { parsed, isError } = parse(await answer(run, requests, 'accept', { agentProfileDraftJson: JSON.stringify(draft) }))
    expect(isError).toBe(true)
    expect(parsed.message).toBe('runtime.effort "max" is not supported by Claude model "sonnet" (supported: low, medium, high).')
    expect(profiles.create).not.toHaveBeenCalled()
  })

  it('returns a neutral refusal with the user feedback and writes nothing on decline', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'codex', name: 'Speedy', description: 'Quick fixes.', model: 'gpt-5.6', options: { fastMode: true } }, deps)
    const { parsed, isError } = parse(await answer(run, requests, 'decline', { feedback: 'Use Claude instead' }))
    expect(isError).toBe(false)
    expect(parsed).toMatchObject({ status: 'rejected', feedback: 'Use Claude instead', message: expect.stringMatching(/Do not retry/) })
    expect(profiles.create).not.toHaveBeenCalled()
  })
})

describe('agent_profile_apply update', () => {
  it('shows a before/after diff of only the changed fields', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', effort: 'max', instructions: '' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm).toMatchObject({
      operation: 'update',
      changes: [
        { field: 'instructions', from: 'Never edit files.' },
        { field: 'effort', from: 'high', to: 'max' },
      ],
    })
    const { parsed } = parse(await answer(run, requests, 'accept'))
    expect(parsed).toMatchObject({ status: 'ok', changed: ['instructions', 'effort'] })
    expect(state.rows.get('claude-reviewer')?.config).toEqual({
      profile: { ...REVIEWER_PROFILE, instructions: undefined, runtime: { model: 'opus', effort: 'max' } },
    })
  })

  it('writes nothing when the row changed while its card was open, so no unseen field is reverted', async () => {
    const first = makeDeps()
    const second = makeDeps()
    const instructionsRun = agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', instructions: 'Review only.' }, first.deps)
    const descriptionRun = agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', description: 'Reads diffs.' }, second.deps)
    await vi.waitFor(() => expect([...first.requests, ...second.requests]).toHaveLength(2))
    expect(parse(await answer(instructionsRun, first.requests, 'accept')).parsed).toMatchObject({ status: 'ok' })

    const { parsed, isError } = parse(await answer(descriptionRun, second.requests, 'accept'))
    expect(isError).toBe(true)
    expect(parsed.message).toMatch(/changed while waiting for confirmation\. Nothing was saved\. Call agent_profile_list/)
    expect(state.rows.get('claude-reviewer')?.config).toMatchObject({
      profile: { instructions: 'Review only.', identity: { description: 'Reviews diffs without editing.' } },
    })
  })

  it('re-checks the name when the card is approved', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'Planner', description: 'Plans.' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    state.rows.set('claude-planner', { ...state.rows.get('claude-reviewer')!, id: 'claude-planner', name: 'planner' })
    const { parsed, isError } = parse(await answer(run, requests, 'accept'))
    expect(isError).toBe(true)
    expect(parsed.message).toMatch(/already exists \(claude-planner\)/)
    expect(profiles.create).not.toHaveBeenCalled()
  })

  it('carries a pre-profile row\'s launch defaults into its first profile', async () => {
    state.rows.set('claude-legacy', {
      id: 'claude-legacy', harnessId: 'claude', name: 'Legacy', isBase: false,
      config: { model: 'sonnet', effort: 'low' }, createdAt: 0, updatedAt: 0,
    })
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'update', id: 'claude-legacy', description: 'Old helper.' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm?.changes).toEqual([{ field: 'description', to: 'Old helper.' }])
    await answer(run, requests, 'accept')
    expect(state.rows.get('claude-legacy')?.config).toMatchObject({ profile: { runtime: { model: 'sonnet', effort: 'low' } } })
  })

  it('keeps built-in rows immutable', async () => {
    const { deps, requests } = makeDeps()
    const { parsed, isError } = parse(await agentProfileApplyHandler({ action: 'update', id: 'claude-base', name: 'Mine' }, deps))
    expect(isError).toBe(true)
    expect(parsed.message).toMatch(/built-in agent and cannot be changed/)
    expect(requests).toHaveLength(0)
  })

  it('refuses a model switch that strands the current effort', async () => {
    const { deps } = makeDeps()
    const { parsed } = parse(await agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', model: 'sonnet', effort: 'max' }, deps))
    expect(parsed.message).toMatch(/runtime.effort "max" is not supported by Claude model "sonnet"/)
  })

  it('drops a model-bound option when the model changes, and clears one on null', async () => {
    state.rows.set('claude-ultra', {
      id: 'claude-ultra', harnessId: 'claude', name: 'Ultra', isBase: false, createdAt: 0, updatedAt: 0,
      config: { profile: { ...REVIEWER_PROFILE, identity: { name: 'Ultra', description: 'd' }, runtime: { model: 'opus', options: { ultracode: true } } } },
    })
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'update', id: 'claude-ultra', model: 'sonnet' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]?.agentProfileConfirm?.changes).toEqual([
      { field: 'model', from: 'opus', to: 'sonnet' },
      { field: 'ultracode', from: 'on' },
    ])
    await answer(run, requests, 'decline')

    const cleared = makeDeps()
    const clearRun = agentProfileApplyHandler({ action: 'update', id: 'claude-ultra', options: { ultracode: null } }, cleared.deps)
    await vi.waitFor(() => expect(cleared.requests).toHaveLength(1))
    expect(cleared.requests[0]?.agentProfileConfirm?.changes).toEqual([{ field: 'ultracode', from: 'on' }])
    await answer(clearRun, cleared.requests, 'decline')
  })

  it('reviews an unchanged legacy Profile for long-term approval and refuses a harness change', async () => {
    const { deps, requests } = makeDeps()
    const pending = agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', effort: 'high' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].agentProfileConfirm?.collaborationApproval).toBeDefined()
    await answer(pending, requests, 'decline')
    expect(parse(await agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', harnessId: 'codex' }, deps)).parsed.message)
      .toMatch(/fixed at creation/)
  })
})

describe('agent_profile_delete', () => {
  it('asks with high risk and deletes on approval, reporting built-in ids it skipped', async () => {
    const { deps, requests, rebindProviderSessions } = makeDeps()
    const run = agentProfileDeleteHandler({ ids: ['claude-reviewer', 'claude-base', 'gone'] }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      riskLevel: 'high',
      allowAlwaysAllow: false,
      agentProfileConfirm: { operation: 'delete', profiles: [{ id: 'claude-reviewer', name: 'Reviewer' }] },
    })
    const { parsed } = parse(await answer(run, requests, 'accept'))
    expect(parsed).toEqual({
      status: 'ok',
      deleted: [{ id: 'claude-reviewer', name: 'Reviewer' }],
      notFound: ['gone'],
      builtIn: ['claude-base'],
    })
    expect(state.rows.has('claude-reviewer')).toBe(false)
    expect(rebindProviderSessions).toHaveBeenCalledWith('claude-reviewer', 'claude-base')
  })

  it('never opens a card for built-in rows alone', async () => {
    const { deps, requests } = makeDeps()
    const { parsed } = parse(await agentProfileDeleteHandler({ ids: ['codex-base'] }, deps))
    expect(parsed).toMatchObject({ status: 'not_found', builtIn: ['codex-base'] })
    expect(requests).toHaveLength(0)
  })

  it('dismisses the card and deletes nothing when the turn is aborted', async () => {
    const controller = new AbortController()
    const { deps, requests } = makeDeps(controller.signal)
    const run = agentProfileDeleteHandler({ ids: ['claude-reviewer'] }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.abort()
    const { parsed, isError } = parse(await run)
    expect(isError).toBe(false)
    expect(parsed.status).toBe('cancelled')
    expect(profiles.delete).not.toHaveBeenCalled()
  })
})


describe('Profile creation collaboration consent', () => {
  it('requires another review if a legacy ACP Profile resolves to a different agent during confirmation', async () => {
    const row = state.rows.get('claude-reviewer')!
    state.rows.set(row.id, { ...row, harnessId: 'acp', config: { profile: { ...REVIEWER_PROFILE, runtime: undefined } } })
    const { deps, requests } = makeDeps()
    const pending = agentProfileApplyHandler({ action: 'update', id: row.id }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].agentProfileConfirm?.profiles[0].acpAgentId).toBe('grok-build')
    state.acpAgentId = 'agent-after'
    expect(parse(await answer(pending, requests, 'accept')).parsed).toMatchObject({ status: 'error', message: expect.stringContaining('changed during review') })
    expect(profiles.update).not.toHaveBeenCalled()
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })
  it.each(['create', 'update'] as const)('requires another review when inherited defaults change during %s confirmation', async (action) => {
    const { deps, requests } = makeDeps()
    const pending = agentProfileApplyHandler(action === 'create'
      ? { action, harnessId: 'claude', name: 'Builder', description: 'Implement tasks.' }
      : { action, id: 'claude-reviewer' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    state.launchDefaults = { sandboxMode: 'on' }
    expect(parse(await answer(pending, requests, 'accept')).parsed).toMatchObject({ status: 'error', message: expect.stringContaining('changed during review') })
    expect(profiles.create).not.toHaveBeenCalled()
    expect(profiles.update).not.toHaveBeenCalled()
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
  })
  it('includes Codex reasoning efforts in the editable approval configuration catalog', async () => {
    const { deps, requests } = makeDeps()
    const pending = agentProfileApplyHandler({ action: 'create', harnessId: 'codex', name: 'Codex Builder', description: 'Implement tasks.', model: 'gpt-5.6', effort: 'medium' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].agentProfileConfirm?.editor?.catalog.models[0].supportedEffortLevels).toEqual(['medium'])
    await answer(pending, requests, 'decline')
  })
  it('persists approval only after the user confirms the exact final configuration', async () => {
    const { deps, requests } = makeDeps()
    const pending = agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'Builder', description: 'Implement tasks.', instructions: 'Make minimal changes.', model: 'sonnet', effort: 'high' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM agent_profile_approvals').get()).toEqual({ count: 0 })
    expect(requests[0].agentProfileConfirm?.collaborationApproval?.config).toMatchObject({ model: 'sonnet', effort: 'high', permissionMode: 'default' })
    const saved = parse(await answer(pending, requests, 'accept')).parsed.profile
    const row = state.rows.get(saved.id)!
    expect(isAgentProfileApproved({ id: row.id, defaultConfig: agentProfileLaunchConfig(row), apiProviders: [] } as import('@superone/shared/agent-types').SessionAgentProfile)).toBe(true)
  })
})


describe('Agent Profile experiment', () => {
  it('refuses stale list, apply and delete calls before reading or requesting consent', async () => {
    state.enabled = false
    const { deps, requests } = makeDeps()
    for (const run of [
      agentProfileListHandler({}),
      agentProfileApplyHandler({ action: 'create', harnessId: 'claude', name: 'Worker', description: 'Build it' }, deps),
      agentProfileDeleteHandler({ ids: ['claude-reviewer'] }, deps),
    ]) {
      const result = await run
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('experimental')
    }
    expect(requests).toHaveLength(0)
    expect(profiles.create).not.toHaveBeenCalled()
    expect(profiles.delete).not.toHaveBeenCalled()
  })

  it.each(['create', 'update', 'delete'] as const)('refuses %s if disabled while its confirmation is open', async (action) => {
    const { deps, requests } = makeDeps()
    const run = action === 'delete'
      ? agentProfileDeleteHandler({ ids: ['claude-reviewer'] }, deps)
      : agentProfileApplyHandler(action === 'create'
        ? { action, harnessId: 'claude', name: 'Worker', description: 'Build it' }
        : { action, id: 'claude-reviewer', description: 'Updated description' }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    state.enabled = false
    const result = await answer(run, requests, 'accept')
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('experimental')
    expect(profiles.create).not.toHaveBeenCalled()
    expect(profiles.update).not.toHaveBeenCalled()
    expect(profiles.delete).not.toHaveBeenCalled()
  })
})
