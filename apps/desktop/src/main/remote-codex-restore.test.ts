import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, CodexUsageInfo } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../mobile/src/runtime'
import { remoteRestoreMessages, stripEventForRemote, stripMessagesForRemote } from './remote-content'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.useRealTimers())

const usage: CodexUsageInfo = {
  totalInputTokens: 82400, totalCachedInputTokens: 0, totalOutputTokens: 50,
  lastInputTokens: 82400, lastCachedInputTokens: 0, lastOutputTokens: 50,
  contextWindow: 400000,
}

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex', ...overrides }
}

describe('Codex restore through the mobile transport and chat runtime', () => {
  it('restores the whole live turn, supersedes stale history, and appends output exactly once', async () => {
    vi.useFakeTimers()
    const user = message('user', { role: 'user', content: [{ type: 'text', text: 'Build it' }] })
    const earlier = message('earlier', { metadata: { codex: { threadId: 'thread', usage: null,
      items: [{ id: 'intro', type: 'agent_message', text: 'Earlier in this turn' }] } } })
    const running = message('running', { status: 'streaming', _lastAppliedSeq: 10, _lastAppliedEpoch: 1,
      metadata: { codex: { threadId: 'thread', usage, items: [
        { id: 'reason', type: 'reasoning', text: 'Thinking before reconnect' },
        { id: 'shell', type: 'command_execution', command: 'build', aggregatedOutput: 'first\n', status: 'in_progress' },
      ] } } })
    const patch = (seq: number, text: string): AgentEvent => ({
      type: 'codex_item_patch', messageId: 'running', itemId: 'shell', phase: 'updated', seq, epoch: 1,
      patch: { type: 'command_execution', aggregatedOutputDelta: text },
    })
    const client = {
      startBuffering() {},
      releaseBuffer: () => ({ epoch: 1, batches: [[patch(10, 'first\n'), patch(11, 'second\n')]] }),
      request: async (command: { type: string }) => {
        if (command.type === 'load_session_messages') return {
          provider: 'codex', hasMore: false, messages: [user, message('running', { status: 'streaming' })],
        }
        if (command.type === 'get_session_state') return {
          status: 'streaming', contextTokens: 82400,
          inProgressMessages: stripMessagesForRemote(remoteRestoreMessages([user, earlier, running])),
        }
        return { ok: true }
      },
    }
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.open('/project', 'session')

    const restored = runtime.messages.find((entry) => entry.id === 'running')!
    expect(runtime.messages.map((entry) => entry.id)).toEqual(['user', 'earlier', 'running'])
    expect(runtime.messages.filter((entry) => entry.id === 'running')).toHaveLength(1)
    expect(runtime.messages.find((entry) => entry.id === 'earlier')?.metadata?.codex?.items[0])
      .toMatchObject({ text: 'Earlier in this turn' })
    expect(restored.metadata?.codex?.items).toMatchObject([
      { text: 'Thinking before reconnect' }, { aggregatedOutput: 'first\nsecond\n' },
    ])
    expect(runtime.contextTokens).toBe(82400)
    expect(runtime.contextWindow).toBe(400000)

    runtime.ingest([stripEventForRemote({ type: 'codex_item_delta', messageId: 'running', phase: 'completed', seq: 12, epoch: 1,
      item: { id: 'shell', type: 'command_execution', command: 'build', aggregatedOutput: 'first\nsecond\ndone', status: 'completed', exitCode: 0 } })])
    expect(runtime.messages.find((entry) => entry.id === 'running')?.metadata?.codex?.items[1])
      .toMatchObject({ aggregatedOutput: 'first\nsecond\ndone', status: 'completed' })
    // A new item used to switch rendering from flattened snapshot blocks to
    // Codex metadata containing only that item, hiding everything before it.
    runtime.ingest([stripEventForRemote({ type: 'codex_item_delta', messageId: 'running', phase: 'started', seq: 13, epoch: 1,
      item: { id: 'answer', type: 'agent_message', text: 'New answer' } })])
    expect(runtime.messages.find((entry) => entry.id === 'running')?.metadata?.codex?.items)
      .toMatchObject([
        { id: 'reason', text: 'Thinking before reconnect' },
        { id: 'shell', aggregatedOutput: 'first\nsecond\ndone', status: 'completed' },
        { id: 'answer', text: 'New answer' },
      ])
    runtime.ingest([stripEventForRemote({ type: 'codex_item_patch', messageId: 'running', itemId: 'answer', phase: 'updated', seq: 14, epoch: 1,
      patch: { type: 'agent_message', textDelta: ' continues' } })])
    expect(runtime.messages.find((entry) => entry.id === 'running')?.metadata?.codex?.items)
      .toMatchObject([
        { id: 'reason', text: 'Thinking before reconnect' },
        { id: 'shell', aggregatedOutput: 'first\nsecond\ndone' },
        { id: 'answer', text: 'New answer continues' },
      ])
    runtime.dispose()
  })

  it('preserves the final usage and item snapshot when the turn completes', () => {
    const event: AgentEvent = { type: 'message_complete', messageId: 'turn', metadata: {
      codex: { threadId: 'thread', usage, items: [{ id: 'answer', type: 'agent_message', text: 'Done' }] },
    } }
    expect(stripEventForRemote(event)).toEqual(event)
  })
})
