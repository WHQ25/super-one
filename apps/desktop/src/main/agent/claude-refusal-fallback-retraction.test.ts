/**
 * Behavioural regression for a refusal fallback mid-turn: the SDK retracts only
 * the refused partial (one API step), but a SuperOne assistant message folds the
 * whole turn's steps into one flat content array. Mapping the retraction onto a
 * message id wiped every tool call the turn had already done — and persisted it.
 *
 * Drives the real SDK-frame mapper into the real persistence reducer and
 * asserts on transcript content, not on the shape of any intermediate event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { MessageBridge } from './message-bridge'

const state = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  queryMock: vi.fn(),
}))

state.queryMock.mockImplementation(() => {
  const messages = [...state.messages]
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) yield msg
    },
  }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: state.queryMock,
  createSdkMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('./claude-binary', () => ({ resolveSdkClaudeBinary: () => '/mock/claude' }))
vi.mock('../harness/resolve-runtime', () => ({
  resolveHarnessRuntime: () => '/mock/claude',
  tryResolveHarnessRuntime: () => '/mock/claude',
  HarnessNotReadyError: class HarnessNotReadyError extends Error { code = 'HARNESS_NOT_READY' as const },
  isHarnessNotReadyError: () => false,
}))
vi.mock('./event-trace', () => ({ trace: vi.fn() }))
vi.mock('../mcp/superone-mcp-server', () => ({
  createSuperoneMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))

import { createSessionQuery } from './claude-query'
import { applyClaudeEventToRuntime, createClaudeRuntime } from './claude-session-runtime'

const TURN_ID = 'msg-turn'

/** Wire frames as CLI 2.1.257 delivered them for session 3140cb8b (cyber refusal). */
const REFUSAL_MID_TURN: Array<Record<string, unknown>> = [
  { type: 'assistant', uuid: 'u-step-1', message: { id: 'api-1', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', uuid: 'u-result-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'a b c' }] } },
  { type: 'assistant', uuid: 'u-step-2', message: { id: 'api-2', content: [{ type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: '/x' } }] } },
  { type: 'user', uuid: 'u-result-2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'contents' }] } },
  // The primary model's refused partial (streamed, then normalised), then the
  // notice that retracts exactly that frame.
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The exploit works by' } } },
  { type: 'assistant', uuid: 'u-refused', message: { id: 'api-3', content: [{ type: 'text', text: 'The exploit works by' }] } },
  {
    type: 'system',
    subtype: 'model_refusal_fallback',
    trigger: 'refusal',
    direction: 'retry',
    scope: 'session',
    original_model: 'claude-opus-5[1m]',
    fallback_model: 'claude-opus-4-8',
    api_refusal_category: 'cyber',
    retracted_message_uuids: ['u-refused'],
    refused_user_message_uuid: 'u-user',
  },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here is a safe summary.' } } },
  { type: 'assistant', uuid: 'u-retry', message: { id: 'api-4', content: [{ type: 'text', text: 'Here is a safe summary.' }] } },
  { type: 'result', subtype: 'success', usage: {} },
]

async function runTurnThroughRuntime(frames: Array<Record<string, unknown>>): Promise<ChatMessage> {
  state.messages = frames
  const events: AgentEvent[] = []
  const handle = createSessionQuery(
    { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
    { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
    (event) => events.push(event),
    () => TURN_ID,
    () => Date.now() - 50,
    () => false,
  )
  await handle.iterationDone

  const turn: ChatMessage = { id: TURN_ID, role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' }
  let runtime = createClaudeRuntime('/repo', 'sess-1', { messages: [turn] })
  for (const event of events) runtime = applyClaudeEventToRuntime(runtime, event)
  const persisted = runtime.messages.find((m) => m.id === TURN_ID)
  if (!persisted) throw new Error('the turn message was evicted from the transcript')
  return persisted
}

beforeEach(() => {
  state.messages = []
  state.queryMock.mockClear()
})

describe('refusal fallback mid-turn', () => {
  it('keeps every tool call the turn already made and drops only the refused partial', async () => {
    const turn = await runTurnThroughRuntime(REFUSAL_MID_TURN)

    const toolUseIds = turn.content.filter((b) => b.type === 'tool_use').map((b) => (b as { toolUseId: string }).toolUseId)
    expect(toolUseIds).toEqual(['tu_1', 'tu_2'])
    expect(turn.content.filter((b) => b.type === 'tool_result')).toHaveLength(2)

    const texts = turn.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text)
    expect(texts).toEqual(['Here is a safe summary.'])
  })
})
