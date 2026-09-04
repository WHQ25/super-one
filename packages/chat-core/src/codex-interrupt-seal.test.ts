import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { reduceLifecycle } from './lifecycle'

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

function statusOf(messages: ChatMessage[]): string | undefined {
  const item = messages[0].metadata?.codex?.items?.[0]
  return item && 'status' in item ? item.status : undefined
}

describe('interrupting a Codex turn', () => {
  it.each([
    ['message_interrupted', 'interrupted'],
    ['message_error', 'error'],
  ] as const)('seals an in-flight tool row on %s', (type, expectedStatus) => {
    const session = createDefaultChatCoreSession()
    session.messages = [codexMessage([runningComputerAct])]
    const event: Parameters<typeof reduceLifecycle>[1] = type === 'message_error'
      ? { type, messageId: 'm1', error: 'stream failed' }
      : { type, messageId: 'm1' }

    const patch = reduceLifecycle(session, event)

    expect(patch.messages![0].status).toBe(expectedStatus)
    expect(statusOf(patch.messages!)).toBe('completed')
  })

  it('leaves finished items untouched', () => {
    const done = { ...runningComputerAct, id: 'item-1', status: 'failed' } as CodexThreadItem
    const session = createDefaultChatCoreSession()
    session.messages = [codexMessage([done])]

    const patch = reduceLifecycle(session, {
      type: 'message_interrupted',
      messageId: 'm1',
    })

    expect(statusOf(patch.messages!)).toBe('failed')
  })
})
