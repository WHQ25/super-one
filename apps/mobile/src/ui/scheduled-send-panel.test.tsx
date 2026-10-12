import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { ScheduledSendPanel } from './scheduled-send-panel'
import { ScheduledSendControl } from './scheduled-send-control'
import { scheduledSendFields } from '../scheduled-send-time'

const controls = (overrides: Partial<ScheduledSendControls> = {}): ScheduledSendControls => ({
  scheduled: null, available: true, loading: false, busy: false, error: '',
  schedule: jest.fn(async () => {}), accept: jest.fn(async () => {}), cancel: jest.fn(async () => {}), dismiss: jest.fn(async () => {}), ...overrides,
})

test('saves the selected local time without an immediate send, and rejects invalid days', async () => {
  const schedule = jest.fn(async (_at: number) => {})
  await renderWithTheme(<ScheduledSendPanel controls={controls({ schedule })} onClose={() => {}} />)
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Date'), '2026-02-30') })
  expect(screen.getByRole('button', { name: 'Schedule Send' })).toBeDisabled()
  const future = new Date(Date.now() + 2 * 86_400_000); future.setHours(18, 30, 0, 0)
  const fields = scheduledSendFields(future.getTime())
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Date'), fields.day) })
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Time'), fields.time) })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Schedule Send' })) })
  expect(schedule).toHaveBeenCalledWith(future.getTime())
})

test('keeps an existing schedule cancellable and presents save failures', async () => {
  const cancel = jest.fn(async () => {})
  await renderWithTheme(<ScheduledSendPanel controls={controls({ cancel, error: 'Control was lost',
    scheduled: { sessionId: 's', sendAt: Date.now() + 3600000, armed: true, message: 'Continue', source: 'manual' } })} onClose={() => {}} />, 'light', 'zh')
  expect(screen.getByText('Control was lost')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: '取消定时发送' })) })
  expect(cancel).toHaveBeenCalledTimes(1)
})

test('a long press leaves the draft unsent while a short tap still sends', async () => {
  const onSend = jest.fn()
  await renderWithTheme(<ScheduledSendControl controls={controls()} empty={false} tablet={false} onSend={onSend} />)
  const send = screen.getByRole('button', { name: 'Send' })
  await act(async () => { fireEvent(send, 'longPress') })
  expect(onSend).not.toHaveBeenCalled()
  await act(async () => { fireEvent.press(send) })
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('disables scheduling and cancellation while disconnected or saving', async () => {
  await renderWithTheme(<ScheduledSendPanel controls={controls({ available: false, scheduled: { sessionId: 's', sendAt: Date.now() + 3600000, armed: true, message: null, source: 'manual' } })} onClose={() => {}} />)
  expect(screen.getByRole('button', { name: 'Schedule Send' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel Scheduled Send' })).toBeDisabled()
})
