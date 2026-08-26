/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, ContentBlock, CodexUsageInfo } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceMessageComplete } = await import('./message-complete')

function assistant(id: string, content: ContentBlock[] = []): ChatMessage {
  return { id, role: 'assistant', status: 'streaming', content, createdAt: '', providerId: 'claude' }
}

function codexUsage(overrides: Partial<CodexUsageInfo> = {}): CodexUsageInfo {
  return {
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalCacheWriteInputTokens: 0,
    totalOutputTokens: 0,
    lastInputTokens: 0,
    lastCachedInputTokens: 0,
    lastCacheWriteInputTokens: 0,
    lastOutputTokens: 0,
    reasoningOutputTokens: 0,
    contextWindow: 0,
    ...overrides,
  }
}

describe('reduceMessageComplete: status settle', () => {
  it("settles status='streaming' → 'idle' when the completing turn is current and has no uncompleted subagents", () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
    } as never)
    expect(patch.status).toBe('idle')
    expect(patch.streamingTokens).toEqual({ input: 0, output: 0 })
  })

  it('does not settle when the turn is older than the latest assistant message', () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [assistant('m1'), assistant('m-newer')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
    } as never)
    expect(patch.status).toBeUndefined()
    // non-current turn does not zero streaming tokens
    expect(patch.streamingTokens).toBeUndefined()
  })

  it('does not settle while the result reports queued sends still pending', () => {
    // The turn completed, but SDK `queued_turn_count` says another turn follows —
    // settling here would flash the composer open between queued turns.
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1', metadata: { queuedTurnCount: 1 },
    } as never)
    expect(patch.status).toBeUndefined()
  })

  it('settles once the result reports the queue drained', () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1', metadata: { queuedTurnCount: 0 },
    } as never)
    expect(patch.status).toBe('idle')
  })

  it("does not settle when status is 'background' (background streaming stays parked)", () => {
    const session = createDefaultPerSessionState()
    session.status = 'background'
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
    } as never)
    expect(patch.status).toBeUndefined()
  })
})

describe('reduceMessageComplete: consumedTokens', () => {
  it('attaches consumedTokens snapshot when this is the current turn and stream produced anything', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1')]
    session.streamingTokens = { input: 100, output: 50 }
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: {},
    } as never)
    const meta = patch.messages?.[0].metadata as { consumedTokens?: { input: number; output: number } }
    expect(meta.consumedTokens).toEqual({ input: 100, output: 50 })
  })

  it('omits consumedTokens for a non-current turn even when stream had tokens', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1'), assistant('newer')]
    session.streamingTokens = { input: 100, output: 50 }
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
    } as never)
    const meta = patch.messages?.[0].metadata as { consumedTokens?: unknown }
    expect(meta?.consumedTokens).toBeUndefined()
  })
})

describe('reduceMessageComplete: codex completion', () => {
  it('merges codex meta + finalResponse content + records codexUsageSnapshot', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1')]
    const usage = codexUsage({ lastInputTokens: 10, contextWindow: 200_000 })

    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: {
        codex: {
          threadId: 'thr-1',
          usage,
          items: [{ id: 'i1', type: 'agent_message', text: 'hi' }],
          finalResponse: 'final answer',
          durationMs: 1234,
        },
      },
    } as never)

    expect(patch.codexUsageSnapshot).toEqual(usage)
    expect(patch.codexTurnLastUsage).toBeNull()
    expect(patch.contextWindow).toBe(200_000)
    const msg = patch.messages?.[0] as ChatMessage
    expect((msg.content[0] as { text: string }).text).toBe('final answer')
    expect(msg.metadata?.durationMs).toBe(1234)
    expect(msg.metadata?.codex?.threadId).toBe('thr-1')
  })

  it('falls back to session.contextWindow when codex contextWindow is 0', () => {
    const session = createDefaultPerSessionState()
    session.contextWindow = 50_000
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: {
        codex: { threadId: null, usage: codexUsage({ contextWindow: 0 }), items: [], finalResponse: '', durationMs: 0 },
      },
    } as never)
    expect(patch.contextWindow).toBe(50_000)
  })

  it('preserves prior codex.items when the event carries an empty items array', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{
      ...assistant('m1'),
      metadata: { codex: { threadId: 't0', usage: null, items: [{ id: 'i-prev', type: 'agent_message', text: 'prev' }] } },
    }]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: { codex: { threadId: 't1', usage: codexUsage(), items: [], finalResponse: '', durationMs: 0 } },
    } as never)
    const msg = patch.messages?.[0] as ChatMessage
    expect(msg.metadata?.codex?.items[0]?.id).toBe('i-prev')
  })

  it('preserves failed mcpStartup servers past completion but drops ready/starting ones', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{
      ...assistant('m1'),
      metadata: { codex: { threadId: 't0', usage: null, items: [], mcpStartup: [
        { name: 'ok', status: 'ready' },
        { name: 'linear', status: 'failed', failureReason: 'reauthenticationRequired' },
      ] } },
    }]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: { codex: { threadId: 't1', usage: codexUsage(), items: [], finalResponse: '', durationMs: 0 } },
    } as never)
    const msg = patch.messages?.[0] as ChatMessage
    expect(msg.metadata?.codex?.mcpStartup).toEqual([
      { name: 'linear', status: 'failed', failureReason: 'reauthenticationRequired' },
    ])
  })
})

describe('reduceMessageComplete: non-codex contextWindow / contextTokens fallbacks', () => {
  it('takes the max contextWindow across event.metadata.modelUsage entries', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: {
        modelUsage: {
          a: { contextWindow: 100 },
          b: { contextWindow: 250 },
        },
      },
    } as never)
    expect(patch.contextWindow).toBe(250)
  })

  it('keeps session.contextWindow when no modelUsage is on the event', () => {
    const session = createDefaultPerSessionState()
    session.contextWindow = 333
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1', metadata: {},
    } as never)
    expect(patch.contextWindow).toBe(333)
  })

  it('keeps session.contextTokens when event.metadata.usage is missing', () => {
    const session = createDefaultPerSessionState()
    session.contextTokens = 9999
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1', metadata: {},
    } as never)
    expect(patch.contextTokens).toBe(9999)
  })

  it('sums input + cacheRead + cacheCreation from event.metadata.usage when present', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
      metadata: { usage: { inputTokens: 10, outputTokens: 0, cacheReadInputTokens: 3, cacheCreationInputTokens: 7 } },
    } as never)
    expect(patch.contextTokens).toBe(20)
  })
})

describe('reduceMessageComplete: uncompleted subagents', () => {
  it("marks unfinished Agent tool uses as completed in taskProgress", () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      assistant('m1', [
        { type: 'tool_use', toolUseId: 'agent-1', toolName: 'Agent', input: '' } as ContentBlock,
      ]),
    ]
    // agent-1 has no taskProgress entry → counted as uncompleted
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1', metadata: {},
    } as never)
    expect(patch.taskProgress?.['agent-1'].completed).toBe(true)
    // status NOT settled because hasUncompletedAgents is true
    // (note: the reducer checks BEFORE marking — settleStatusIdle uses
    // hasUncompletedAgents, computed before the patch)
    expect(patch.status).toBeUndefined()
  })

  it('omits taskProgress when there are no Agent tool uses', () => {
    const session = createDefaultPerSessionState()
    session.messages = [assistant('m1')]
    const patch = reduceMessageComplete(session, {
      type: 'message_complete', messageId: 'm1',
    } as never)
    expect(patch.taskProgress).toBeUndefined()
  })
})
