import { nativeRestoreClient, nativeLoadFixture } from './session/native-restore.test-fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, CodexCommandExecutionItem, CodexThreadItem, CodexUsageInfo, ContentBlock } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { codexContentEvents } from '@superone/shared/test-fixtures/codex-content'
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
    const earlier = message('earlier', { content: [{ type: 'text', id: 'intro', text: 'Earlier in this turn' }] })
    const shell: CodexCommandExecutionItem = { id: 'shell', type: 'command_execution', command: 'build', aggregatedOutput: 'first\n', status: 'in_progress' }
    const items: CodexThreadItem[] = [{ id: 'reason', type: 'reasoning', text: 'Thinking before reconnect' }, shell,
      { ...shell, aggregatedOutput: 'first\nsecond\n' }, { ...shell, aggregatedOutput: 'first\nsecond\ndone', status: 'completed', exitCode: 0 },
      { id: 'answer', type: 'agent_message', text: 'New answer' }, { id: 'answer', type: 'agent_message', text: 'New answer continues' }]
    // The producer's events for the whole turn, numbered as the node sequenced them.
    const events = codexContentEvents('running', ...items).map((event, index): AgentEvent => ({ ...event, seq: index + 9, epoch: 1 }))
    const applied = events.filter(event => event.seq! <= 10)
    const running = message('running', { status: 'streaming', _lastAppliedSeq: 10, _lastAppliedEpoch: 1,
      content: applied.reduce<ContentBlock[]>((content, event) => event.type === 'content_delta' ? applyContentDelta(content, event.delta) : content, []),
      metadata: { codex: { threadId: 'thread', usage, items: [] } } })
    const client = nativeRestoreClient(() => nativeLoadFixture({ status: 'streaming', sessionProvider: 'codex', contextTokens: 82400,
      codexUsage: usage }, [user, message('running', { status: 'streaming' })], stripMessagesForRemote(remoteRestoreMessages([user, earlier, running]))),
      () => [events.filter(event => event.seq === 10 || event.seq === 11).map(stripEventForRemote)])
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.open('/project', 'session')

    const blocks = () => runtime.messages.find((entry) => entry.id === 'running')!.content
    expect(runtime.messages.map((entry) => entry.id)).toEqual(['user', 'earlier', 'running'])
    expect(runtime.messages.filter((entry) => entry.id === 'running')).toHaveLength(1)
    expect(runtime.messages.find((entry) => entry.id === 'earlier')?.content).toMatchObject([{ text: 'Earlier in this turn' }])
    expect(blocks()).toMatchObject([{ thinking: 'Thinking before reconnect' }, { liveOutput: 'first\nsecond\n' }])
    expect(runtime.contextTokens).toBe(82400)
    expect(runtime.contextWindow).toBe(400000)

    runtime.ingest(events.filter(event => event.seq! > 11).map(stripEventForRemote))
    expect(blocks()).toMatchObject([{ thinking: 'Thinking before reconnect' }, { type: 'bash', status: 'complete' },
      { type: 'tool_result', summary: 'first\nsecond\ndone', exitCode: 0 }, { text: 'New answer continues' }])
    runtime.dispose()
  })

  it('preserves the final usage and item snapshot when the turn completes', () => {
    const event: AgentEvent = { type: 'message_complete', messageId: 'turn', metadata: {
      codex: { threadId: 'thread', usage, items: [{ id: 'answer', type: 'agent_message', text: 'Done' }] },
    } }
    expect(stripEventForRemote(event)).toEqual(event)
  })

  it('keeps a legacy turn whole and strips a content-shaped Codex turn like any other', () => {
    const legacy = message('legacy', { metadata: { codex: { threadId: 'thread', usage, items: [
      { id: 'shell', type: 'command_execution', command: 'bun test', aggregatedOutput: 'passed', status: 'completed' },
    ] } } })
    const content = message('content', {
      content: [
        { type: 'tool_use', toolName: 'Bash', toolUseId: 'b', input: '{"command":"bun test"}', status: 'complete' },
        { type: 'tool_result', toolUseId: 'b', summary: 'passed' },
      ],
      metadata: { codex: { threadId: 'thread', usage, items: [] } },
    })
    const [keptLegacy, stripped] = stripMessagesForRemote([legacy, content])
    expect(keptLegacy).toEqual(legacy)
    expect(stripped.content.map(block => block.type)).toEqual(['bash', 'bash_result'])
  })
})
