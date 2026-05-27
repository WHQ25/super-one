/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent, ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ sandboxCapability: null }) },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({}) },
}))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

// Force the full chat-store module graph to evaluate top-down once before we
// touch the reducer directly. Without this, the cycle codex.ts →
// codex-helpers → store-helpers → defaults → selectors (which itself reads
// SUBAGENT_COLOR_POOL_SIZE at module scope) races and TDZ-throws.
await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceCodex } = await import('./codex')

function makeMessage(id: string, codex?: Partial<NonNullable<ChatMessage['metadata']>['codex']>): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: '',
    providerId: 'codex',
    metadata: codex ? { codex: { threadId: null, usage: null, items: [], ...codex } } : undefined,
  }
}

describe('reduceCodex: codex_thread_started', () => {
  it('writes the threadId onto the target assistant message metadata', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('m1')]

    const event: Extract<AgentEvent, { type: 'codex_thread_started' }> = {
      type: 'codex_thread_started',
      messageId: 'm1',
      threadId: 'thread-xyz',
    }

    const patch = reduceCodex(session, event)
    expect(patch.messages?.[0].metadata?.codex?.threadId).toBe('thread-xyz')
    expect(patch.lastEventAt).toBeGreaterThan(0)
  })

  it('preserves prior codex.items + usage when threading in the threadId', () => {
    const session = createDefaultPerSessionState()
    const prevItems: CodexThreadItem[] = [{ id: 'i1', type: 'agent_message', text: 'hi' }]
    session.messages = [makeMessage('m1', { items: prevItems, usage: null })]

    const patch = reduceCodex(session, {
      type: 'codex_thread_started',
      messageId: 'm1',
      threadId: 'thread-xyz',
    })

    expect(patch.messages?.[0].metadata?.codex?.items).toBe(prevItems)
  })

  it('treats messages other than the target as unchanged references', () => {
    const session = createDefaultPerSessionState()
    const m1 = makeMessage('m1')
    const m2 = makeMessage('m2')
    session.messages = [m1, m2]

    const patch = reduceCodex(session, {
      type: 'codex_thread_started',
      messageId: 'm2',
      threadId: 't-2',
    })
    expect(patch.messages?.[0]).toBe(m1)
  })

  it('is a tick-only patch when the event would be replayed for the target message', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{ ...makeMessage('m1'), _lastAppliedSeq: 5 } as ChatMessage]

    const patch = reduceCodex(session, {
      type: 'codex_thread_started',
      messageId: 'm1',
      threadId: 't',
      seq: 3,
    } as never)
    expect(patch.messages).toBeUndefined()
    expect(patch.lastEventAt).toBeGreaterThan(0)
  })
})

describe('reduceCodex: codex_item_delta', () => {
  it('appends a new codex thread item via upsertCodexItem', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('m1', { items: [] })]
    const item: CodexThreadItem = { id: 'i1', type: 'agent_message', text: 'hello' }

    const patch = reduceCodex(session, {
      type: 'codex_item_delta',
      messageId: 'm1',
      item,
    } as never)
    expect(patch.messages?.[0].metadata?.codex?.items).toEqual([item])
  })

  it('replaces an existing item with the same id (upsert)', () => {
    const session = createDefaultPerSessionState()
    const old: CodexThreadItem = { id: 'i1', type: 'agent_message', text: 'first' }
    session.messages = [makeMessage('m1', { items: [old] })]
    const next: CodexThreadItem = { id: 'i1', type: 'agent_message', text: 'second' }

    const patch = reduceCodex(session, {
      type: 'codex_item_delta',
      messageId: 'm1',
      item: next,
    } as never)
    expect(patch.messages?.[0].metadata?.codex?.items).toEqual([next])
  })

  it('seeds metadata.codex when the target message had no codex metadata', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{ ...makeMessage('m1'), metadata: undefined }]
    const item: CodexThreadItem = { id: 'i1', type: 'reasoning', text: 'think' }

    const patch = reduceCodex(session, {
      type: 'codex_item_delta',
      messageId: 'm1',
      item,
    } as never)
    expect(patch.messages?.[0].metadata?.codex?.items).toEqual([item])
    expect(patch.messages?.[0].metadata?.codex?.threadId).toBeNull()
  })

  it('is a tick-only patch when the event is a replay for the target message', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{ ...makeMessage('m1'), _lastAppliedSeq: 9 } as ChatMessage]

    const patch = reduceCodex(session, {
      type: 'codex_item_delta',
      messageId: 'm1',
      item: { id: 'i1', type: 'agent_message', text: 'x' } as CodexThreadItem,
      seq: 5,
    } as never)
    expect(patch.messages).toBeUndefined()
    expect(patch.lastEventAt).toBeGreaterThan(0)
  })
})
