/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PerSessionState } from '@/stores/chat-store/types'
import { useScheduledSendsStore } from '@/stores/scheduled-sends'
import { shouldReuseDraftOriginSessionId } from './draft-session-origin'

const armed = {
  sessionId: 'original',
  sendAt: Date.now() + 3_600_000,
  message: 'continue later',
  armed: true,
  source: 'rate_limit' as const,
}

beforeEach(() => {
  useScheduledSendsStore.setState({ bySession: {} })
})

describe('draft session origin', () => {
  it('reuses the persisted scheduled session before the sidebar list loads', async () => {
    const getScheduledSend = vi.fn().mockResolvedValue(armed)
    Object.assign(window, { app: { getScheduledSend } })

    expect(await shouldReuseDraftOriginSessionId('original', undefined)).toBe(true)
    expect(useScheduledSendsStore.getState().bySession).toEqual({})
    expect(getScheduledSend).toHaveBeenCalledWith('original')
  })

  it('mints a new session when the old one has no armed send', async () => {
    useScheduledSendsStore.setState({ bySession: { original: armed } })
    Object.assign(window, { app: { getScheduledSend: vi.fn().mockResolvedValue({ ...armed, armed: false }) } })
    expect(await shouldReuseDraftOriginSessionId('original', undefined)).toBe(false)
  })

  it('does not query when the draft has no origin session', async () => {
    const getScheduledSend = vi.fn()
    Object.assign(window, { app: { getScheduledSend } })
    expect(await shouldReuseDraftOriginSessionId(null, undefined)).toBe(false)
    expect(getScheduledSend).not.toHaveBeenCalled()
  })

  it('reuses an unsent session already in memory', async () => {
    const getScheduledSend = vi.fn()
    Object.assign(window, { app: { getScheduledSend } })
    const existing = {
      messages: [], status: 'idle', pendingPermissions: [],
      pendingQuestion: null, pendingPlanApproval: null, awaitingAssistantReply: false,
    } as unknown as PerSessionState

    expect(await shouldReuseDraftOriginSessionId('original', existing)).toBe(true)
    expect(getScheduledSend).not.toHaveBeenCalled()
  })

  it('does not mint a new ID when the persisted read fails', async () => {
    Object.assign(window, { app: { getScheduledSend: vi.fn().mockRejectedValue(new Error('IPC unavailable')) } })
    await expect(shouldReuseDraftOriginSessionId('original', undefined)).rejects.toThrow('IPC unavailable')
  })
})
