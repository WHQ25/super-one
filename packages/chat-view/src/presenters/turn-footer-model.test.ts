import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { turnFooterModel, ZERO_TURN_TOKENS } from './turn-footer-model'

function turn(metadata: ChatMessage['metadata'], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 't1',
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: '2026-09-07T00:00:00.000Z',
    providerId: 'claude',
    metadata,
    ...overrides,
  }
}

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
}

const settled = { isStreaming: false, streamingTokens: ZERO_TURN_TOKENS, frozenTokens: ZERO_TURN_TOKENS, elapsedMs: 0 }

describe('turn footer spend', () => {
  it('prefers consumedTokens over every other record of the same turn', () => {
    const model = turnFooterModel({
      ...settled,
      message: turn({
        consumedTokens: { input: 10, output: 20 },
        usage: usage(999, 999),
      }),
    })
    expect([model.tokenInput, model.tokenOutput]).toEqual([10, 20])
  })

  it('falls back to metadata.usage, where the main runtime records Grok and Claude spend', () => {
    const model = turnFooterModel({
      ...settled,
      message: turn({ usage: usage(7, 3) }),
    })
    expect([model.tokenInput, model.tokenOutput]).toEqual([7, 3])
  })

  it('falls back to Codex last-turn usage, discounting its cached input', () => {
    const model = turnFooterModel({
      ...settled,
      message: turn({
        codex: {
          threadId: 'th1',
          usage: {
            lastInputTokens: 100,
            lastCachedInputTokens: 40,
            lastOutputTokens: 12,
            totalInputTokens: 100,
            totalCachedInputTokens: 40,
            totalOutputTokens: 12,
            reasoningOutputTokens: 0,
            contextWindow: 200_000,
          },
          items: [],
        },
      }),
    })
    expect([model.tokenInput, model.tokenOutput]).toEqual([60, 12])
  })

  it('keeps the last live counters when a turn settles before its usage lands', () => {
    const model = turnFooterModel({
      ...settled,
      frozenTokens: { input: 5, output: 9 },
      message: turn({}),
    })
    expect([model.tokenInput, model.tokenOutput]).toEqual([5, 9])
  })

  it('reads live counters, not recorded ones, while the turn streams', () => {
    const model = turnFooterModel({
      message: turn({ consumedTokens: { input: 999, output: 999 } }),
      isStreaming: true,
      streamingTokens: { input: 4, output: 1 },
      frozenTokens: ZERO_TURN_TOKENS,
      elapsedMs: 3000,
    })
    expect([model.tokenInput, model.tokenOutput]).toEqual([4, 1])
  })
})

describe('turn footer duration', () => {
  it('shows a live clock after a second but hides a short settled turn', () => {
    const live = turnFooterModel({ ...settled, isStreaming: true, elapsedMs: 1500, message: turn({}) })
    expect(live.showDuration).toBe(true)
    expect(live.durationLabel).toBe('2s')

    const brief = turnFooterModel({ ...settled, message: turn({ durationMs: 1500 }) })
    expect(brief.showDuration).toBe(false)
    expect(brief.durationLabel).toBe('')
  })

  it('shows a settled turn that ran long enough to be worth the row', () => {
    const model = turnFooterModel({ ...settled, message: turn({ durationMs: 95_000 }) })
    expect(model.durationLabel).toBe('1m 35s')
  })
})

describe('turn footer failure', () => {
  const errorInfo = { raw: 'overloaded_error' } as NonNullable<ChatMessage['metadata']>['errorInfo']

  it('suppresses the terminal-reason chip when the error badge already names the failure', () => {
    const model = turnFooterModel({ ...settled, message: turn({ errorInfo, terminalReason: 'api_error' }) })
    expect(model.showError).toBe(true)
    expect(model.showTerminalReason).toBe(false)
  })

  it('shows a terminal reason on its own', () => {
    const model = turnFooterModel({ ...settled, message: turn({ terminalReason: 'max_turns' }) })
    expect(model.showTerminalReason).toBe(true)
  })

  it('says nothing about a completed or interrupted turn', () => {
    expect(turnFooterModel({ ...settled, message: turn({ terminalReason: 'completed' }) }).showTerminalReason).toBe(false)
    expect(turnFooterModel({
      ...settled,
      message: turn({ terminalReason: 'aborted_tools' }, { status: 'interrupted' }),
    }).showTerminalReason).toBe(false)
  })

  it('holds the failure back until the turn settles', () => {
    const model = turnFooterModel({
      ...settled,
      isStreaming: true,
      elapsedMs: 2000,
      message: turn({ errorInfo, terminalReason: 'api_error' }),
    })
    expect(model.showError).toBe(false)
    expect(model.showTerminalReason).toBe(false)
  })
})

describe('an empty turn footer', () => {
  it('reports nothing worth rendering when the turn was quick, free and clean', () => {
    expect(turnFooterModel({ ...settled, message: turn({ durationMs: 800 }) }).isEmpty).toBe(true)
  })
})
