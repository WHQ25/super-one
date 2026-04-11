import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../../shared/agent-types'

const mockReadUserPreferences = vi.fn()
const mockCreateSessionQuery = vi.fn()
const mockBuildUserMessage = vi.fn()

const bridgeInstances: Array<{
  push: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  dequeue: ReturnType<typeof vi.fn>
  onConsumed: ((tag: string) => void) | null
}> = []

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../database', () => ({ getActiveProviderRaw: vi.fn() }))
vi.mock('./claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  rejectAllPending: vi.fn(),
}))
vi.mock('./message-bridge', () => ({
  MessageBridge: class {
    push = vi.fn()
    close = vi.fn()
    dequeue = vi.fn(() => false)
    consumedTags: string[] = []
    drainConsumedTag = vi.fn()
    onConsumed: ((tag: string) => void) | null = null
    constructor() {
      bridgeInstances.push(this as any)
    }
  },
}))
vi.mock('./claude-query', () => ({
  createSessionQuery: (...args: unknown[]) => mockCreateSessionQuery(...args),
  buildUserMessage: (...args: unknown[]) => mockBuildUserMessage(...args),
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

let onStepBoundary: (() => void) | undefined
let resolveIteration: (() => void) | undefined

function setupMocks() {
  mockReadUserPreferences.mockReturnValue({
    outputStyle: '',
    defaultPermissionMode: '',
    defaultSandboxMode: '',
  })
  mockCreateSessionQuery.mockImplementation((...args: unknown[]) => {
    onStepBoundary = args[8] as (() => void) | undefined
    return {
      query: { setPermissionMode: vi.fn(), setModel: vi.fn(), close: vi.fn(), abort: vi.fn(), interrupt: vi.fn() },
      iterationDone: new Promise<void>((resolve) => { resolveIteration = resolve }),
    }
  })
  mockBuildUserMessage.mockImplementation((req: any) => ({
    type: 'user',
    message: { role: 'user', content: req.content },
    parent_tool_use_id: null,
    session_id: 'test-session',
  }))
}

async function createAgent(): Promise<{ agent: ClaudeAgent; events: AgentEvent[] }> {
  const agent = new ClaudeAgent()
  const events: AgentEvent[] = []
  await agent.initialize({ cwd: '/tmp/test' }, (e) => events.push(e))
  return { agent, events }
}

function getLatestBridge() {
  return bridgeInstances[bridgeInstances.length - 1]
}

function startTurn(agent: ClaudeAgent): { complete: () => void } {
  const sendPromise = agent.sendMessage({ content: 'trigger-turn', effort: undefined })
  const messageId = (agent as any).currentMessageId as string
  return {
    complete: () => {
      (agent as any).emit({ type: 'message_complete', messageId, metadata: {} })
      sendPromise.catch(() => {})
    },
  }
}

describe('ClaudeAgent pendingQueued', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeInstances.length = 0
    onStepBoundary = undefined
    resolveIteration = undefined
    setupMocks()
  })

  it('queued message goes to pendingQueued when turn is active', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    const turn = startTurn(agent)
    bridge.push.mockClear()

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    expect(bridge.push).not.toHaveBeenCalled()
    turn.complete()
  })

  it('queued message goes directly to bridge when no active turn', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    expect(bridge.push).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user' }),
      'q1',
    )
  })

  it('flushPendingQueued pushes to bridge on step boundary', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    const turn = startTurn(agent)
    bridge.push.mockClear()

    await agent.sendMessage({ content: 'queued-1', priority: 'next', clientMessageId: 'q1' })
    await agent.sendMessage({ content: 'queued-2', priority: 'next', clientMessageId: 'q2' })

    expect(bridge.push).not.toHaveBeenCalled()

    onStepBoundary!()

    expect(bridge.push).toHaveBeenCalledTimes(2)
    expect(bridge.push).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ content: 'queued-1' }) }),
      'q1',
    )
    expect(bridge.push).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ content: 'queued-2' }) }),
      'q2',
    )
    turn.complete()
  })

  it('dequeueMessage removes from pendingQueued before checking bridge', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    const turn = startTurn(agent)

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    const result = agent.dequeueMessage('q1')
    expect(result).toBe(true)
    expect(bridge.dequeue).not.toHaveBeenCalled()

    bridge.push.mockClear()
    onStepBoundary!()
    expect(bridge.push).not.toHaveBeenCalled()
    turn.complete()
  })

  it('dequeueMessage falls back to bridge when not in pendingQueued', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    bridge.dequeue.mockReturnValue(true)

    const result = agent.dequeueMessage('unknown-id')
    expect(result).toBe(true)
    expect(bridge.dequeue).toHaveBeenCalledWith('unknown-id')
  })

  it('interrupt flushes pendingQueued to bridge', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    startTurn(agent)
    bridge.push.mockClear()

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    await agent.interrupt()

    expect(bridge.push).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ content: 'queued' }) }),
      'q1',
    )
  })

  it('resetSession clears pendingQueued without flushing', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    startTurn(agent)
    bridge.push.mockClear()

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    resolveIteration!()
    await agent.resetSession()

    expect(bridge.push).not.toHaveBeenCalledWith(
      expect.anything(),
      'q1',
    )
  })

  it('multiple step boundaries only flush once', async () => {
    const { agent } = await createAgent()
    const bridge = getLatestBridge()
    const turn = startTurn(agent)
    bridge.push.mockClear()

    await agent.sendMessage({ content: 'queued', priority: 'next', clientMessageId: 'q1' })

    onStepBoundary!()
    onStepBoundary!()

    expect(bridge.push).toHaveBeenCalledTimes(1)
    turn.complete()
  })
})
