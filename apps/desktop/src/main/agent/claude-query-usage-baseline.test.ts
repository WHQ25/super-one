import { describe, expect, it, vi } from 'vitest'
import type { ModelUsageInfo } from '@superone/shared/agent-types'

const usageStats = vi.hoisted(() => ({
  recordClaudeStepDeltas: vi.fn(),
}))

vi.mock('../usage-stats-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../usage-stats-service')>()),
  recordClaudeStepDeltas: usageStats.recordClaudeStepDeltas,
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('./event-trace', () => ({ trace: vi.fn() }))

import { iterateMessages } from './claude-query'

function usage(inputTokens: number, outputTokens: number): ModelUsageInfo {
  return { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 }
}

function result(modelUsage: Record<string, ModelUsageInfo>) {
  return { type: 'result', subtype: 'success', modelUsage }
}

async function drive(
  messages: Array<Record<string, unknown>>,
  modelUsageBaseline?: Record<string, ModelUsageInfo>,
): Promise<void> {
  const q = {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) yield msg
    },
  }
  await iterateMessages(q as never, {
    emit: () => undefined,
    getCurrentMessageId: () => 'msg-1',
    getCurrentStartTime: () => 0,
    getInterrupted: () => false,
    superoneSessionId: 'sess-1',
    bridge: { consumedTags: [], drainConsumedTag: () => undefined } as never,
    timing: { pausedMs: 0 },
    modelUsageBaseline,
  })
}

function recordedDeltas(): Array<Record<string, { inputTokens: number; outputTokens: number }>> {
  return usageStats.recordClaudeStepDeltas.mock.calls.map((call) => call[0])
}

/**
 * `result.modelUsage` is cumulative for the query, and since SDK 0.3.277 a
 * resumed or forked session's first result continues from the totals its
 * transcript saved. Those earlier turns were recorded when they ran.
 */
describe('iterateMessages: usage deltas across a resume', () => {
  it('records the first result of a fresh session in full', async () => {
    usageStats.recordClaudeStepDeltas.mockClear()
    await drive([result({ 'claude-x': usage(100, 20) })])
    expect(recordedDeltas()).toEqual([{ 'claude-x': expect.objectContaining({ inputTokens: 100, outputTokens: 20 }) }])
  })

  it('records only the new step when the resumed result carries the saved totals', async () => {
    usageStats.recordClaudeStepDeltas.mockClear()
    await drive(
      [result({ 'claude-x': usage(130, 27) }), result({ 'claude-x': usage(145, 30) })],
      { 'claude-x': usage(100, 20) },
    )
    expect(recordedDeltas()).toEqual([
      { 'claude-x': expect.objectContaining({ inputTokens: 30, outputTokens: 7 }) },
      { 'claude-x': expect.objectContaining({ inputTokens: 15, outputTokens: 3 }) },
    ])
  })

  it('counts a model absent from the baseline in full', async () => {
    usageStats.recordClaudeStepDeltas.mockClear()
    await drive([result({ 'claude-x': usage(100, 20), 'claude-y': usage(8, 2) })], { 'claude-x': usage(100, 20) })
    expect(recordedDeltas()).toEqual([
      {
        'claude-x': expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
        'claude-y': expect.objectContaining({ inputTokens: 8, outputTokens: 2 }),
      },
    ])
  })
})
