import { describe, expect, it } from 'vitest'
import { createSimulatedTurnRunner } from './index'
import type { NodeSessionRecord } from './types'

function session(): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'codex',
    providerId: 'codex',
    title: null,
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: null,
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
  }
}

describe('createSimulatedTurnRunner', () => {
  it('streams chunks via onDelta', async () => {
    const runner = createSimulatedTurnRunner({
      delayMs: 0,
      chunks: ['a', 'b'],
    })
    const deltas: string[] = []
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
    })
    expect(result.finalText).toBe('ab')
    expect(deltas).toEqual(['a', 'b'])
  })
})
