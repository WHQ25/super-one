import { nativeRestoreClient, nativeLoadFixture } from './session/native-restore.test-fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, CodexUsageInfo } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../mobile/src/runtime'
import { remoteRestoreMessages, stripEventForRemote, stripMessagesForRemote } from './remote-content'
import { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'

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
  it('retains cold-hydrated catalog item rows through the phone projection', async () => {
    const catalog = sessionMessageBlocksToChatMessages([{ id: 'turn', role: 'assistant', text: 'Done', createdAt: 1, sortOrder: 0,
      metadata: { codex: { threadId: 'thread', usage: null, items: [
        { id: 'shell', type: 'command_execution', command: 'bun test', aggregatedOutput: 'passed', status: 'completed' },
      ] } },
    }], 'codex')
    const restored = stripMessagesForRemote(remoteRestoreMessages(catalog))
    const client = nativeRestoreClient(() => nativeLoadFixture({ status: 'idle', sessionProvider: 'codex' }, restored))
    const runtime = new ChatRuntime(client as never, vi.fn())
    try {
      await runtime.open('/project', 'session')
      expect(runtime.messages[0].metadata?.codex?.items).toMatchObject([{ id: 'shell', type: 'command_execution', command: 'bun test', status: 'completed' }])
      expect(runtime.messages[0].metadata?.codex?.threadId).toBe('thread')
    } finally { runtime.dispose() }
  })

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
    const client = nativeRestoreClient(() => nativeLoadFixture({ status: 'streaming', sessionProvider: 'codex', contextTokens: 82400,
      codexUsage: usage }, [user, message('running', { status: 'streaming' })], stripMessagesForRemote(remoteRestoreMessages([user, earlier, running]))),
      () => [[patch(10, 'first\n'), patch(11, 'second\n')]])
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
