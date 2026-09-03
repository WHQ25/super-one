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

// Same module-graph warm-up as codex.test.ts: the reducer cycle TDZ-throws
// when the store index has not evaluated first.
await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceLifecycle } = await import('./lifecycle')

/** The tool row from the reported bug: computer_act still pressing when Stop landed. */
const runningComputerAct = {
  id: 'item-9',
  type: 'mcp_tool_call',
  server: 'superone',
  tool: 'computer_act',
  status: 'in_progress',
  arguments: { actions: [{ type: 'press', ref: '@e50' }], description: 'Cancel pairing' },
} as unknown as CodexThreadItem

function codexMessage(items: CodexThreadItem[]): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: '',
    providerId: 'codex',
    metadata: { codex: { threadId: 't1', usage: null, items } },
  }
}

/** Narrow past the union members (agent_message, reasoning) that carry no status. */
function statusOf(messages: ChatMessage[]): string | undefined {
  const item = messages[0].metadata?.codex?.items?.[0]
  return item && 'status' in item ? item.status : undefined
}

describe('interrupting a Codex turn', () => {
  it('stops an in-flight tool row from rendering as still running', () => {
    const session = createDefaultPerSessionState()
    session.messages = [codexMessage([runningComputerAct])]
    const event = { type: 'message_interrupted', messageId: 'm1' } as Extract<
      AgentEvent,
      { type: 'message_interrupted' }
    >

    const patch = reduceLifecycle(session, event)

    expect(patch.messages![0].status).toBe('interrupted')
    // in_progress is what the Codex renderer maps to a streaming row, so leaving
    // it is what kept "Pressing…" shimmering under the Interrupted footer.
    expect(statusOf(patch.messages!)).toBe('completed')
  })

  it('stops it on a failed turn too', () => {
    const session = createDefaultPerSessionState()
    session.messages = [codexMessage([runningComputerAct])]
    const event = {
      type: 'message_error',
      messageId: 'm1',
      error: 'stream failed',
    } as Extract<AgentEvent, { type: 'message_error' }>

    const patch = reduceLifecycle(session, event)

    expect(patch.messages![0].status).toBe('error')
    expect(statusOf(patch.messages!)).toBe('completed')
  })

  it('leaves finished items untouched', () => {
    const done = { ...runningComputerAct, id: 'item-1', status: 'failed' } as CodexThreadItem
    const session = createDefaultPerSessionState()
    session.messages = [codexMessage([done])]
    const event = { type: 'message_interrupted', messageId: 'm1' } as Extract<
      AgentEvent,
      { type: 'message_interrupted' }
    >

    const patch = reduceLifecycle(session, event)

    expect(statusOf(patch.messages!)).toBe('failed')
  })
})
