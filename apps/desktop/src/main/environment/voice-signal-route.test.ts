import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { desktopVoiceSignal } from './voice-signal-route'

describe('desktopVoiceSignal', () => {
  it('stamps the desktop remote key so the signal stays on the remote session topic', () => {
    const event = {
      type: 'realtime_call_signal',
      sessionId: 'sid',
      projectPath: '/work/app',
      signal: { kind: 'answer', sdp: 'v=0\r\na=answer', attemptId: 'a', hostEpoch: 'e', callId: 'c', generation: 1 },
    } satisfies AgentEvent
    expect(desktopVoiceSignal(event, 'remote:env-1:/work/app')).toMatchObject({
      type: 'realtime_call_signal',
      sessionId: 'sid',
      projectPath: 'remote:env-1:/work/app',
    })
  })

  it('ignores events that are not a voice signal', () => {
    expect(desktopVoiceSignal({ type: 'status_change', status: 'idle', sessionId: 'sid' }, 'remote:env-1:/work/app')).toBeNull()
  })
})
