import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PermissionMode } from '../../shared/agent-types'

const mockReadUserPreferences = vi.fn()
const mockCreateSessionQuery = vi.fn()

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../database', () => ({ getActiveProviderRaw: vi.fn() }))
vi.mock('./claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  rejectAllPending: vi.fn(),
}))
vi.mock('./message-bridge', () => ({
  MessageBridge: class { close = vi.fn(); push = vi.fn(); consumedTags = []; drainConsumedTag = vi.fn() },
}))
vi.mock('./claude-query', () => ({
  createSessionQuery: (...args: unknown[]) => mockCreateSessionQuery(...args),
  buildUserMessage: vi.fn(),
}))
vi.mock('./discover-resources', () => ({
  discoverSkills: vi.fn(() => []),
  discoverProjectCommands: vi.fn(() => []),
  discoverProjectAgents: vi.fn(() => []),
}))
vi.mock('./event-trace', () => ({ trace: vi.fn() }))
vi.mock('../claude-preferences-service', () => ({
  readUserPreferences: () => mockReadUserPreferences(),
}))

import { ClaudeAgent } from './claude-agent'

function setupMocks(prefs: { defaultPermissionMode?: string; defaultSandboxMode?: string } = {}) {
  mockReadUserPreferences.mockReturnValue({
    outputStyle: '',
    defaultPermissionMode: prefs.defaultPermissionMode ?? '',
    defaultSandboxMode: prefs.defaultSandboxMode ?? '',
  })
  mockCreateSessionQuery.mockReturnValue({
    query: { setPermissionMode: vi.fn() },
    iterationDone: new Promise<void>(() => {}),
  })
}

describe('ClaudeAgent.initialize permission mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses desktop default when no override provided', async () => {
    setupMocks({ defaultPermissionMode: 'bypassPermissions' })
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never))

    const modeUsed = mockCreateSessionQuery.mock.calls[0][1].permissionMode
    expect(modeUsed).toBe('bypassPermissions')
  })

  it('overrides desktop default with mobile permission mode', async () => {
    setupMocks({ defaultPermissionMode: 'bypassPermissions' })
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never), undefined, {
      permissionMode: 'plan',
    })

    const modeUsed = mockCreateSessionQuery.mock.calls[0][1].permissionMode
    expect(modeUsed).toBe('plan')
  })

  it('emits permission_mode_change with overridden mode', async () => {
    setupMocks({ defaultPermissionMode: 'default' })
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never), undefined, {
      permissionMode: 'plan',
    })

    const modeChangeEvents = events.filter((e) => e.type === 'permission_mode_change')
    expect(modeChangeEvents).toHaveLength(1)
    expect(modeChangeEvents[0].mode).toBe('plan')
  })

  it('does not emit permission_mode_change when result is default', async () => {
    setupMocks({ defaultPermissionMode: 'bypassPermissions' })
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never), undefined, {
      permissionMode: 'default',
    })

    const modeChangeEvents = events.filter((e) => e.type === 'permission_mode_change')
    expect(modeChangeEvents).toHaveLength(0)
  })

  it('does not override when no permissionMode in overrides', async () => {
    setupMocks({ defaultPermissionMode: 'acceptEdits' })
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never), undefined, {})

    const modeUsed = mockCreateSessionQuery.mock.calls[0][1].permissionMode
    expect(modeUsed).toBe('acceptEdits')
  })
})

describe('ClaudeAgent.setPermissionMode', () => {
  it('emits permission_mode_change before awaiting SDK', async () => {
    setupMocks()
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    let sdkResolve: () => void
    const sdkPromise = new Promise<void>((r) => { sdkResolve = r })
    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: () => sdkPromise },
      iterationDone: new Promise<void>(() => {}),
    })
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never))
    events.length = 0

    const promise = agent.setPermissionMode('acceptEdits')
    expect(events).toEqual([{ type: 'permission_mode_change', mode: 'acceptEdits' }])

    sdkResolve!()
    await promise
  })

  it('skips SDK call when session is not alive', async () => {
    setupMocks()
    const agent = new ClaudeAgent()
    const events: { type: string; mode?: PermissionMode }[] = []
    const sdkSetMode = vi.fn()
    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: sdkSetMode },
      iterationDone: Promise.resolve(),
    })
    await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e as never))
    await new Promise((r) => setTimeout(r, 0))
    events.length = 0

    await agent.setPermissionMode('acceptEdits')
    expect(events).toEqual([{ type: 'permission_mode_change', mode: 'acceptEdits' }])
    expect(sdkSetMode).not.toHaveBeenCalled()
  })
})

describe('ClaudeAgent.resumeSession with permissionMode', () => {
  it('applies permissionMode before creating session', async () => {
    setupMocks()
    const agent = new ClaudeAgent()
    let resolveInit!: () => void
    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: vi.fn(), close: vi.fn() },
      iterationDone: new Promise<void>((r) => { resolveInit = r }),
    })
    await agent.initialize({ cwd: '/tmp/test' }, vi.fn())
    resolveInit()
    await new Promise((r) => setTimeout(r, 0))

    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: vi.fn(), close: vi.fn() },
      iterationDone: new Promise<void>(() => {}),
    })
    await agent.resumeSession('target-sid', 'acceptEdits')

    expect(agent.getCurrentPermissionMode()).toBe('acceptEdits')
    const lastCall = mockCreateSessionQuery.mock.calls[mockCreateSessionQuery.mock.calls.length - 1]
    expect(lastCall[1].permissionMode).toBe('acceptEdits')
  })

  it('keeps current mode when permissionMode is omitted', async () => {
    setupMocks()
    const agent = new ClaudeAgent()
    let resolveInit!: () => void
    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: vi.fn(), close: vi.fn() },
      iterationDone: new Promise<void>((r) => { resolveInit = r }),
    })
    await agent.initialize({ cwd: '/tmp/test' }, vi.fn())
    await agent.setPermissionMode('bypassPermissions')
    resolveInit()
    await new Promise((r) => setTimeout(r, 0))

    mockCreateSessionQuery.mockReturnValue({
      query: { setPermissionMode: vi.fn(), close: vi.fn() },
      iterationDone: new Promise<void>(() => {}),
    })
    await agent.resumeSession('target-sid')

    expect(agent.getCurrentPermissionMode()).toBe('bypassPermissions')
    const lastCall = mockCreateSessionQuery.mock.calls[mockCreateSessionQuery.mock.calls.length - 1]
    expect(lastCall[1].permissionMode).toBe('bypassPermissions')
  })
})
