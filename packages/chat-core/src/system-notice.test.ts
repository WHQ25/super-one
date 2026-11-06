import { describe, expect, it } from 'vitest'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

describe('process notices', () => {
  it('appends the notice without restarting the last-event activity clock', () => {
    const session = { ...createDefaultChatCoreSession(), lastEventAt: 0 }
    const patch = applyEventToSession(session, { type: 'user_message_appended', message: {
      id: 'notice', role: 'assistant', providerId: 'system', content: [], status: 'complete', createdAt: '',
      metadata: { systemNotice: { source: 'Claude Code', level: 'warning' } },
    } })
    expect(patch.messages).toHaveLength(1)
    expect({ ...session, ...patch }.lastEventAt).toBe(0)
  })
})
