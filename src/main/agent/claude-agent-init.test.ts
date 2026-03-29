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
