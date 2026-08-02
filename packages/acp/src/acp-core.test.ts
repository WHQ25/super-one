import { describe, expect, it } from 'vitest'
import { createSimulatedAcpTurnRunner } from './index'
import type { NodeSessionRecord } from '@superone/runtime/session'

function session(): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'acp',
    providerId: 'acp',
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
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
  }
}

describe('createSimulatedAcpTurnRunner', () => {
  it('streams acp-labeled chunks', async () => {
    const runner = createSimulatedAcpTurnRunner({ delayMs: 0 })
    const deltas: string[] = []
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
    })
    expect(result.finalText).toContain('acp')
    expect(deltas.join('')).toBe(result.finalText)
  })
})
