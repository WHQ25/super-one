import { expect, test, vi } from 'vitest'
import type { ScheduledSendControls } from './navigation/use-scheduled-send'
import { handleScheduledSendAction } from './scheduled-send-webview'

test('accepts the current unarmed card and ignores actions for a replaced schedule or session', () => {
  const controls: ScheduledSendControls = { scheduled: { sessionId: 's', sendAt: 1000, source: 'rate_limit', armed: false, message: null },
    available: true, loading: false, busy: false, error: '', schedule: vi.fn(async () => {}),
    accept: vi.fn(async () => {}), dismiss: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  const raw = (sessionId: string, sendAt: number, action = 'accept') => JSON.stringify({ type: 'scheduledSendAction', sessionId, sendAt, action })
  expect(handleScheduledSendAction(raw('old', 1000), controls)).toBe(true)
  expect(handleScheduledSendAction(raw('s', 999), controls)).toBe(true)
  expect(controls.accept).not.toHaveBeenCalled()
  handleScheduledSendAction(raw('s', 1000), controls)
  expect(controls.accept).toHaveBeenCalledTimes(1)
  handleScheduledSendAction(raw('s', 1000, 'cancel'), controls)
  expect(controls.cancel).not.toHaveBeenCalled()
  controls.scheduled!.armed = true
  handleScheduledSendAction(raw('s', 1000), controls)
  expect(controls.accept).toHaveBeenCalledTimes(1)
  handleScheduledSendAction(raw('s', 1000, 'cancel'), controls)
  expect(controls.cancel).toHaveBeenCalledTimes(1)
})
