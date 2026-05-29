/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, CodexUsageInfo } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceUsage } = await import('./usage')

function makeUsage(overrides: Partial<CodexUsageInfo> = {}): CodexUsageInfo {
  return {
    totalInputTokens: 100,
    totalCachedInputTokens: 20,
    totalOutputTokens: 50,
    lastInputTokens: 30,
    lastCachedInputTokens: 5,
    lastOutputTokens: 20,
    reasoningOutputTokens: 0,
    contextWindow: 200_000,
    ...overrides,
  }
}

describe('reduceUsage: message_usage', () => {
  it('writes streamingTokens from inputTokens/outputTokens when no codexUsage is present', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 42,
      outputTokens: 11,
    } as never)
    expect(patch.streamingTokens).toEqual({ input: 42, output: 11 })
    expect(patch.codexUsageSnapshot).toBeUndefined()
  })

  it('accumulates codex footer tokens + roll-up when codexUsage is present', () => {
    const session = createDefaultPerSessionState()
    session.streamingTokens = { input: 5, output: 5 }
    session.codexTurnLastUsage = null
    const codexUsage = makeUsage({ lastInputTokens: 30, lastCachedInputTokens: 5, lastOutputTokens: 20 })

    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 0,
      outputTokens: 0,
      codexUsage,
    } as never)

    expect(patch.codexUsageSnapshot).toBe(codexUsage)
    expect(patch.codexTurnLastUsage).toBe(codexUsage)
    expect(patch.contextWindow).toBe(200_000)
    // streamingTokens grows by step (lastInput - lastCached) + lastOutput
    expect(patch.streamingTokens).toEqual({ input: 5 + (30 - 5), output: 5 + 20 })
  })

  it('keeps session.contextTokens when getCodexContextTokens returns 0 (defensive)', () => {
    const session = createDefaultPerSessionState()
    session.contextTokens = 9999
    const codexUsage = makeUsage({ lastInputTokens: 0 })

    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 0,
      outputTokens: 0,
      codexUsage,
    } as never)

    expect(patch.contextTokens).toBe(9999)
  })

  it('keeps session.contextWindow when codexUsage.contextWindow is 0', () => {
    const session = createDefaultPerSessionState()
    session.contextWindow = 100_000
    const codexUsage = makeUsage({ contextWindow: 0 })

    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 0,
      outputTokens: 0,
      codexUsage,
    } as never)

    expect(patch.contextWindow).toBe(100_000)
  })

  it('is a tick-only patch when the event is a replay for the target message', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      { id: 'm1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude', _lastAppliedSeq: 10 } as ChatMessage,
    ]
    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 1,
      outputTokens: 1,
      seq: 5,
    } as never)
    expect(patch.messages).toBeUndefined()
    expect(patch.streamingTokens).toBeUndefined()
    expect(patch.lastEventAt).toBeGreaterThan(0)
  })

  it('applies seq to the target message when not a replay', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      { id: 'm1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } as ChatMessage,
    ]
    const patch = reduceUsage(session, {
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 1,
      outputTokens: 1,
      seq: 7,
    } as never)
    expect((patch.messages?.[0] as ChatMessage)._lastAppliedSeq).toBe(7)
  })
})

describe('reduceUsage: status_indicator', () => {
  it('toggles isCompacting=true and clears prior error for indicator=compacting', () => {
    const session = { ...createDefaultPerSessionState(), compactError: 'stale' }
    expect(reduceUsage(session, {
      type: 'status_indicator', indicator: 'compacting',
    } as never)).toEqual({ isCompacting: true, compactError: null })
  })

  it('toggles isCompacting=false for indicator=null without a result', () => {
    expect(reduceUsage(createDefaultPerSessionState(), {
      type: 'status_indicator', indicator: null,
    } as never)).toEqual({ isCompacting: false })
  })

  it('records compactError and clears pending markers when compactResult=failed', () => {
    expect(reduceUsage(createDefaultPerSessionState(), {
      type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: 'context too small',
    } as never)).toEqual({
      isCompacting: false,
      compactError: 'context too small',
      _pendingCompactUserId: '',
      _pendingSlashCommand: '',
    })
  })

  it('falls back to a generic message when compactResult=failed has no error text', () => {
    const patch = reduceUsage(createDefaultPerSessionState(), {
      type: 'status_indicator', indicator: null, compactResult: 'failed',
    } as never)
    expect(patch.compactError).toBe('Compaction failed')
  })
})

describe('reduceUsage: rate_limit', () => {
  it('clears rateLimitInfo when status=allowed', () => {
    expect(reduceUsage(createDefaultPerSessionState(), {
      type: 'rate_limit', status: 'allowed',
    } as never)).toEqual({ rateLimitInfo: null })
  })

  it('stores the limit metadata when status is not allowed', () => {
    const patch = reduceUsage(createDefaultPerSessionState(), {
      type: 'rate_limit',
      status: 'rate_limited',
      resetsAt: 9999,
      rateLimitType: 'tokens',
      utilization: 0.95,
    } as never)
    expect(patch.rateLimitInfo).toEqual({
      status: 'rate_limited',
      resetsAt: 9999,
      rateLimitType: 'tokens',
      utilization: 0.95,
    })
  })
})

describe('reduceUsage: api_retry', () => {
  it('records the retry attempt + delay metadata', () => {
    const patch = reduceUsage(createDefaultPerSessionState(), {
      type: 'api_retry',
      attempt: 2,
      maxRetries: 5,
      delayMs: 750,
    } as never)
    expect(patch.apiRetry).toEqual({ attempt: 2, maxRetries: 5, delayMs: 750 })
  })
})
