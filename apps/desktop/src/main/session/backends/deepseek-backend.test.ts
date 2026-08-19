import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'

const { createAgentMock, approvalRouters } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  approvalRouters: new Map<string, (request: unknown) => Promise<string>>(),
}))

const setPermissionPresetMock = vi.fn()

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../deepseek/deepseek-runtime-host', () => ({
  DEEPSEEK_DEFAULT_PROVIDER: 'deepseek-official',
  DEEPSEEK_DEFAULT_MODEL: 'deepseek-v4-pro',
  getDeepseekRuntime: async () => ({ createAgent: createAgentMock, setPermissionPreset: setPermissionPresetMock }),
  registerApprovalRouter: (sessionId: string, router: (request: unknown) => Promise<string>) => {
    approvalRouters.set(sessionId, router)
    return () => approvalRouters.delete(sessionId)
  },
}))

import { DeepseekBackend } from './deepseek-backend'

function makeOpts(overrides: Partial<BackendStartOptions> = {}): BackendStartOptions {
  return {
    sessionId: 's1',
    projectPath: '/tmp/p',
    cwd: '/tmp/p',
    config: {},
    permissionMode: 'default',
    abortController: new AbortController(),
    ...overrides,
  }
}

interface FakeAgent {
  sent: string[]
  routes: Array<Record<string, string>>
  cancelled: number
  disposed: number
}

function installFakeAgent(): FakeAgent {
  const state: FakeAgent = { sent: [], routes: [], cancelled: 0, disposed: 0 }
  createAgentMock.mockImplementation(async (options: { sessionId: string }) => ({
    sessionId: options.sessionId,
    sendText: (text: string) => state.sent.push(text),
    setRoute: (route: Record<string, string>) => state.routes.push(route),
    cancel: () => { state.cancelled += 1 },
    whenIdle: async () => {},
    status: () => 'idle' as const,
    dispose: async () => { state.disposed += 1 },
  }))
  return state
}

describe('DeepseekBackend', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
    approvalRouters.clear()
  })

  it('uses the canonical dsh harness id', () => {
    expect(new DeepseekBackend().kind).toBe('dsh')
  })

  it('reports the minted provider session id so cold resume can find the dsh log', async () => {
    installFakeAgent()
    const backend = new DeepseekBackend()
    const events: AgentEvent[] = []
    const ids: string[] = []
    backend.onEvent((event) => events.push(event))
    backend.onProviderSessionId((id) => ids.push(id))

    await backend.start(makeOpts())

    const reported = events.find((event) => event.type === 'provider_session_id')
    expect(reported).toBeDefined()
    expect(ids).toHaveLength(1)
    expect(ids[0]).toBe(reported?.type === 'provider_session_id' ? reported.providerSessionId : null)
  })

  it('resumes the persisted dsh session when a provider session id is supplied', async () => {
    installFakeAgent()
    const backend = new DeepseekBackend()

    await backend.start(makeOpts({ providerSessionId: 'existing-dsh-id' }))

    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'existing-dsh-id', resume: true }),
    )
  })

  it('parks a dsh approval question until the user answers the permission popover', async () => {
    installFakeAgent()
    const backend = new DeepseekBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts())

    const router = [...approvalRouters.values()][0]
    expect(router).toBeDefined()
    let settled: string | undefined
    void router!({ toolName: 'bash', callId: 'call-1', reason: 'wants shell' })
      .then((decision) => { settled = decision })

    await Promise.resolve()
    const prompt = events.find((event) => event.type === 'permission_request')
    // Canonical name, so the popover matches the tool row rendered above it.
    expect(prompt?.type === 'permission_request' && prompt.request.toolName).toBe('Bash')
    expect(settled).toBeUndefined()

    const requestId = prompt?.type === 'permission_request' ? prompt.request.requestId : ''
    expect(backend.getPendingInteractions()).toHaveLength(1)
    expect(backend.respondToPermission(requestId, true)).toBe(true)
    await Promise.resolve()

    expect(settled).toBe('allowed-once')
    expect(backend.getPendingInteractions()).toHaveLength(0)
  })

  it('denies the tool when the user rejects, and auto-allows under bypass mode', async () => {
    installFakeAgent()
    const backend = new DeepseekBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeOpts())
    const router = [...approvalRouters.values()][0]!

    let denied: string | undefined
    void router({ toolName: 'bash' }).then((decision) => { denied = decision })
    await Promise.resolve()
    const prompt = events.find((event) => event.type === 'permission_request')
    const requestId = prompt?.type === 'permission_request' ? prompt.request.requestId : ''
    backend.respondToPermission(requestId, false)
    await Promise.resolve()
    expect(denied).toBe('rejected')

    await backend.setPermissionMode('bypassPermissions')
    await expect(router({ toolName: 'bash' })).resolves.toBe('allowed-once')
  })

  /**
   * The shared mode is only the carrier. What the user actually selected is a
   * dsh preset, and a preset that never reaches the tree leaves the sandbox on
   * whatever the session was created with.
   */
  it('translates the shared permission mode into a dsh preset', async () => {
    installFakeAgent()
    const backend = new DeepseekBackend()
    await backend.start(makeOpts())
    setPermissionPresetMock.mockClear()

    await backend.setPermissionMode('plan')
    await backend.setPermissionMode('bypassPermissions')

    expect(setPermissionPresetMock.mock.calls.map((call) => call[1]))
      .toEqual(['read-only', 'danger-full-access'])
  })

  it('routes a model change in place instead of rebuilding the agent', async () => {
    const agent = installFakeAgent()
    const backend = new DeepseekBackend()
    await backend.start(makeOpts())

    await backend.setModel('deepseek-v4-flash')

    expect(agent.routes).toEqual([{ model: 'deepseek-v4-flash' }])
    expect(createAgentMock).toHaveBeenCalledTimes(1)
    expect(agent.disposed).toBe(0)
  })

  it('cancels the live agent on interrupt and drops pending approvals on close', async () => {
    const agent = installFakeAgent()
    const backend = new DeepseekBackend()
    await backend.start(makeOpts())
    const router = [...approvalRouters.values()][0]!

    let outcome: string | undefined
    void router({ toolName: 'bash' }).then((decision) => { outcome = decision })
    await Promise.resolve()

    await backend.interrupt()
    expect(agent.cancelled).toBe(1)

    await backend.close()
    await Promise.resolve()
    expect(outcome).toBe('rejected')
    expect(agent.disposed).toBe(1)
    expect(backend.hasActiveRuntime()).toBe(false)
  })
})
