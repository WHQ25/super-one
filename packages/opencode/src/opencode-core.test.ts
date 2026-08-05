import { describe, expect, it } from 'vitest'
import { createSimulatedOpenCodeTurnRunner } from './index'
import type { NodeSessionRecord } from '@superone/runtime/session'

function session(): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'opencode',
    providerId: 'opencode',
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
    alwaysAllowedTools: [],
  }
}

describe('createSimulatedOpenCodeTurnRunner', () => {
  it('streams opencode-labeled chunks', async () => {
    const runner = createSimulatedOpenCodeTurnRunner({ delayMs: 0 })
    const deltas: string[] = []
    const result = await runner({
      session: session(),
      text: 'hi',
      onDelta: (d) => deltas.push(d),
      signal: new AbortController().signal,
    })
    expect(result.finalText).toContain('opencode')
    expect(deltas.join('')).toBe(result.finalText)
  })
})
