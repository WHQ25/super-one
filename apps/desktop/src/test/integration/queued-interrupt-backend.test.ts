import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageBridge } from '../../main/agent/message-bridge'
import sdkFixture from '../fixtures/recordings/queued-interrupt.sdk.json'

const sdkMessages = sdkFixture as unknown as Array<Record<string, unknown>>

const state = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  onYield: undefined as undefined | ((m: Record<string, unknown>) => void),
  queryMock: vi.fn(),
}))

state.queryMock.mockImplementation(() => {
  const messages = [...state.messages]
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        state.onYield?.(msg)
        yield msg
      }
    },
    interrupt: vi.fn(),
    setModel: vi.fn(),
  }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: state.queryMock,
  createSdkMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))
vi.mock('../../main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../main/agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../../main/mcp/superone-mcp-server', () => ({ createSuperoneMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })) }))
// buildClaudeOptions hard-gates on a resolvable harness binary, which reaches
// HarnessManager -> better-sqlite3. This suite replays a recording and never
// spawns, so stub the gate rather than stand up a real database.
vi.mock('../../main/harness/resolve-runtime', () => ({
  resolveHarnessRuntime: () => '/mock/claude',
  tryResolveHarnessRuntime: () => '/mock/claude',
  HarnessNotReadyError: class HarnessNotReadyError extends Error {
    code = 'HARNESS_NOT_READY' as const
  },
  isHarnessNotReadyError: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'HARNESS_NOT_READY',
}))

const { createSessionQuery } = await import('../../main/agent/claude-query')

const TURN1_ID = 'msg_turn1'

function isInterruptMarker(m: Record<string, unknown>): boolean {
  const msg = m.message as { content?: unknown } | undefined
  return m.type === 'user' && typeof msg?.content !== 'string' && JSON.stringify(msg?.content ?? '').includes('Request interrupted')
}

beforeEach(() => {
  state.messages = []
  state.onYield = undefined
  state.queryMock.mockClear()
})

describe('queued message + interrupt — backend layer (recording: queued-interrupt.sdk)', () => {
  it('emits status_change idle after the post-interrupt queued turn completes', async () => {
    state.messages = sdkMessages

    const events: Array<Record<string, unknown>> = []

    // Faithful mirror of ClaudeBackend's closures.
    let currentMessageId = TURN1_ID
    let interrupted = false
    // The SDK echoes "[Request interrupted by user]" once backend.interrupt()
    // has fired; flip the flag exactly there, like the real backend.
    state.onYield = (m) => { if (isInterruptMarker(m)) interrupted = true }

    const onQueuedTurnStart = (messageId: string): void => {
      currentMessageId = messageId
      interrupted = false
    }

    const bridge = {
      consumedTags: ['q1'],
      drainConsumedTag: () => 'q1',
    } as unknown as MessageBridge

    const handle = createSessionQuery(
      bridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn(), abortController: new AbortController() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentMessageId,
      () => Date.now() - 1000,
      () => interrupted,
      vi.fn(),
      onQueuedTurnStart,
      vi.fn(),
    )
    await handle.iterationDone

    const lastCompleteIdx = events.findLastIndex((e) => e.type === 'message_complete')
    const idleAfterComplete = events
      .slice(lastCompleteIdx + 1)
      .some((e) => e.type === 'status_change' && (e.status === 'idle' || e.status === 'background'))

    // Characterization of the deep-dive finding: under a faithful mirror of
    // ClaudeBackend's closures, createSessionQuery DOES emit the final idle
    // after the post-interrupt queued turn. So Bug B's missing idle is not a
    // createSessionQuery logic defect — it is a real-runtime delivery race,
    // which is why the fix lives in the renderer (settle status on
    // message_complete) rather than here.
    expect(lastCompleteIdx).toBeGreaterThanOrEqual(0)
    expect(idleAfterComplete).toBe(true)
  })
})
