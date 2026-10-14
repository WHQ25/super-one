import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode as toonDecode } from '@toon-format/toon'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { SessionProvider } from '../session/types'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const state = vi.hoisted(() => ({
  rows: new Map<string, SessionProvider>(),
  nextId: 1,
}))

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock('../session/session-provider-repo', () => ({
  listSessionProviders: () => [...state.rows.values()],
  getSessionProvider: (id: string) => state.rows.get(id) ?? null,
  getBaseProvider: (harnessId: string) => state.rows.get(`${harnessId}-base`)!,
  createSessionProvider: vi.fn((input: { harnessId: SessionProvider['harnessId']; name: string; config: unknown }) => {
    const row: SessionProvider = { id: `${input.harnessId}-p${state.nextId++}`, isBase: false, createdAt: 0, updatedAt: 0, ...input }
    state.rows.set(row.id, row)
    return row
  }),
  updateSessionProvider: vi.fn((id: string, patch: { name?: string; config?: unknown }) => {
    const row = { ...state.rows.get(id)!, ...patch }
    state.rows.set(id, row)
    return row
  }),
  deleteSessionProvider: vi.fn((id: string) => state.rows.delete(id)),
}))

const CLAUDE_MODELS = [
  { id: 'sonnet', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
  { id: 'opus', name: 'Opus', supportedEffortLevels: ['low', 'high', 'max'] },
  { id: 'opus[1m]', name: 'Opus 1M', supportedEffortLevels: ['low', 'high', 'max'] },
]
const CODEX_MODELS = [
  { id: 'gpt-5.6', name: 'GPT-5.6', supportedReasoningEfforts: [{ value: 'medium' }], serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] },
]

vi.mock('../session/agent-profiles', () => ({
  isProviderUsable: () => true,
  resolveAcpAgentId: () => 'grok-build',
  profileResources: (row: SessionProvider) => {
    const models = row.harnessId === 'claude' ? CLAUDE_MODELS : row.harnessId === 'codex' ? CODEX_MODELS : []
    return { models, efforts: [], catalog: { models }, defaultConfig: { model: models[0]?.id } }
  },
}))

import { _resetAgentProfileConfirmsForTests, resolveAgentProfileConfirm } from './agent-profile-confirm'
import { agentProfileApplyHandler, agentProfileDeleteHandler, agentProfileListHandler } from './agent-profile-tools'
import * as repo from '../session/session-provider-repo'

const REVIEWER_PROFILE = {
  version: 1,
  identity: { name: 'Reviewer', description: 'Reviews diffs without editing.' },
  instructions: 'Never edit files.',
  runtime: { model: 'opus', effort: 'high' },
}

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
  const deps: BuiltInSuperoneToolDeps = {
    notifyDevAppReady: vi.fn(),
    sessionId: 'sess-1',
    sessionHost: {
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
  return { deps, requests }
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
  seed()
  vi.clearAllMocks()
  _resetAgentProfileConfirmsForTests()
})

describe('agent_profile_list', () => {
  it('lists base and custom rows as a flat table', () => {
    const { parsed } = parse(agentProfileListHandler({}))
    expect(parsed.count).toBe(4)
    expect(parsed.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude-base', base: true, model: '' }),
      expect.objectContaining({ id: 'claude-reviewer', base: false, description: 'Reviews diffs without editing.', model: 'opus', effort: 'high' }),
    ]))
  })

  it('returns full instructions and the harness options for one id', () => {
    const { parsed } = parse(agentProfileListHandler({ id: 'claude-reviewer' }))
    expect(parsed.profile).toMatchObject({ instructions: 'Never edit files.', runtime: { model: 'opus', effort: 'high' } })
    expect((parsed.options as { models: unknown[] }).models).toEqual([
      { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'], fastMode: false, contexts: ['default'] },
      { id: 'opus', name: 'Opus', efforts: ['low', 'high', 'max'], fastMode: false, contexts: ['default', '1m'] },
    ])
  })

  it('points an unknown id back at the list', () => {
    const { parsed, isError } = parse(agentProfileListHandler({ id: 'nope' }))
    expect(isError).toBe(true)
    expect(parsed.message).toMatch(/agent_profile_list without id/)
  })
})

describe('agent_profile_apply create', () => {
  it('shows the full config on the confirm card and writes only after approval', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Architect', description: 'Plans large refactors.',
      instructions: 'Write a plan first.', model: 'opus[1m]', effort: 'max',
    }, deps)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(repo.createSessionProvider).not.toHaveBeenCalled()
    expect(requests[0]).toMatchObject({
      requestKind: 'agent_profile_confirm',
      allowAlwaysAllow: false,
      agentProfileConfirm: {
        operation: 'create',
        profiles: [{
          harnessId: 'claude', name: 'Architect', description: 'Plans large refactors.', instructions: 'Write a plan first.',
          model: 'opus', modelName: 'Opus', effort: 'max', context: '1m', unsupported: ['fastMode'],
        }],
      },
    })
    const { parsed } = parse(await answer(run, requests, 'accept'))
    expect(parsed).toMatchObject({ status: 'ok', action: 'create', profile: { name: 'Architect', runtime: { model: 'opus', context: '1m' } } })
    expect(repo.createSessionProvider).toHaveBeenCalledWith({
      harnessId: 'claude',
      name: 'Architect',
      config: {
        profile: {
          version: 1,
          identity: { name: 'Architect', description: 'Plans large refactors.' },
          instructions: 'Write a plan first.',
          runtime: { model: 'opus', effort: 'max', context: '1m' },
        },
      },
    })
  })

  it('rejects an unsupported combination by name before asking the user', async () => {
    const { deps, requests } = makeDeps()
    const { parsed, isError } = parse(await agentProfileApplyHandler({
      action: 'create', harnessId: 'claude', name: 'Fast', description: 'x', model: 'opus', fastMode: true,
    }, deps))
    expect(isError).toBe(true)
    expect(parsed.message).toBe('runtime.fastMode is not supported by Claude model "opus".')
    expect(requests).toHaveLength(0)
  })

  it('pins the ACP agent the user runs today', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'acp', name: 'Groker', description: 'Grok helper.' }, deps)
    await answer(run, requests, 'accept')
    expect(requests[0]?.agentProfileConfirm?.profiles[0]).toMatchObject({ acpAgentId: 'grok-build' })
    expect(repo.createSessionProvider).toHaveBeenCalledWith(expect.objectContaining({
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

  it('returns a neutral refusal with the user feedback and writes nothing on decline', async () => {
    const { deps, requests } = makeDeps()
    const run = agentProfileApplyHandler({ action: 'create', harnessId: 'codex', name: 'Speedy', description: 'Quick fixes.', model: 'gpt-5.6', fastMode: true }, deps)
    const { parsed, isError } = parse(await answer(run, requests, 'decline', { feedback: 'Use Claude instead' }))
    expect(isError).toBe(false)
    expect(parsed).toMatchObject({ status: 'rejected', feedback: 'Use Claude instead', message: expect.stringMatching(/Do not retry/) })
    expect(repo.createSessionProvider).not.toHaveBeenCalled()
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

  it('refuses a no-op and a harness change', async () => {
    const { deps } = makeDeps()
    expect(parse(await agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', effort: 'high' }, deps)).parsed.message)
      .toMatch(/Nothing to change/)
    expect(parse(await agentProfileApplyHandler({ action: 'update', id: 'claude-reviewer', harnessId: 'codex' }, deps)).parsed.message)
      .toMatch(/fixed at creation/)
  })
})

describe('agent_profile_delete', () => {
  it('asks with high risk and deletes on approval, reporting built-in ids it skipped', async () => {
    const { deps, requests } = makeDeps()
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
    expect(repo.deleteSessionProvider).not.toHaveBeenCalled()
  })
})
