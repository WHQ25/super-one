import { describe, expect, it } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession } from '@superone/chat-core'
import type { CodexUsageInfo } from '@superone/shared/agent-types'

describe('Codex completion from the session event stream', () => {
  it('keeps whole-turn token accounting when completion clears streaming state', () => {
    let session = createDefaultChatCoreSession()
    const apply = (event: Parameters<typeof applyEventToSession>[1]) => {
      session = { ...session, ...applyEventToSession(session, event) }
    }
    apply({ type: 'message_start', message: { id: 'assistant', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' } })
    const usage: CodexUsageInfo = {
      totalInputTokens: 10000, totalCachedInputTokens: 2000, totalOutputTokens: 4000,
      lastInputTokens: 10000, lastCachedInputTokens: 2000, lastOutputTokens: 4000,
      reasoningOutputTokens: 0, contextWindow: 200000,
    }
    for (const current of [usage, { ...usage, totalInputTokens: 22000, totalCachedInputTokens: 13000, totalOutputTokens: 4200, lastInputTokens: 12000, lastCachedInputTokens: 11000, lastOutputTokens: 200 }]) {
      apply({ type: 'message_usage', messageId: 'assistant', inputTokens: current.lastInputTokens, outputTokens: current.lastOutputTokens, codexUsage: current })
    }
    expect(session.streamingTokens).toEqual({ input: 9000, output: 4200 })
    apply({ type: 'message_complete', messageId: 'assistant', metadata: { codex: { threadId: 'thread', usage, items: [] } } })
    expect(session.streamingTokens).toEqual({ input: 0, output: 0 })
    expect(session.messages[0].metadata?.consumedTokens).toEqual({ input: 9000, output: 4200 })
    expect(session.messages[0].metadata?.codex?.threadId).toBe('thread')
  })
})
