import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { ScheduledSendPanel } from './scheduled-send-panel'
import { ScheduledSendControl } from './scheduled-send-control'
import { scheduledSendFields } from '../scheduled-send-time'
import { useState } from 'react'
import type { ScheduledSend } from '@superone/shared/agent-types'

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
  expect(screen.queryByLabelText('发送日期')).toBeNull()
  expect(screen.queryByLabelText('发送时间')).toBeNull()
  expect(screen.queryByRole('button', { name: '1 小时后' })).toBeNull()
  expect(screen.queryByRole('button', { name: '定时发送' })).toBeNull()
  expect(screen.getByText(/^发送时间:/)).toBeTruthy()
  expect(screen.getByText('发送内容')).toBeTruthy()
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
  expect(screen.queryByRole('button', { name: 'Schedule Send' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Cancel Scheduled Send' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
})

test('shows the default continuation as explicitly labelled message content', async () => {
  await renderWithTheme(<ScheduledSendPanel controls={controls({ scheduled: {
    sessionId: 's', sendAt: Date.now() + 3_600_000, armed: true, source: 'rate_limit', message: null,
  } })} onClose={() => {}} />)
  expect(screen.getByText('Message to Send')).toBeTruthy()
  expect(screen.getByText('Continue')).toBeTruthy()
})

test('editing starts with the scheduled time and can be abandoned without cancelling the task', async () => {
  const sendAt = Date.now() + 2 * 3_600_000
  const fields = scheduledSendFields(sendAt)
  const schedule = jest.fn(async (_at: number) => {})
  const cancel = jest.fn(async () => {})
  const onClose = jest.fn()
  await renderWithTheme(<ScheduledSendPanel controls={controls({ schedule, cancel, scheduled: {
    sessionId: 's', sendAt, armed: true, source: 'manual', message: 'Check the tests',
  } })} onClose={onClose} />)
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Edit' })) })
  expect(screen.getByLabelText('Scheduled Date').props.value).toBe(fields.day)
  expect(screen.getByLabelText('Scheduled Time').props.value).toBe(fields.time)
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Time'), '18:30') })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Cancel' })) })
  expect(screen.queryByLabelText('Scheduled Date')).toBeNull()
  expect(screen.getByText('Check the tests')).toBeTruthy()
  expect(schedule).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test('saves an edited time and leaves failed edits open for retry', async () => {
  const schedule = jest.fn(async (_at: number) => {})
  schedule.mockRejectedValueOnce(new Error('Disconnected'))
  const onClose = jest.fn()
  await renderWithTheme(<ScheduledSendPanel controls={controls({ schedule, scheduled: {
    sessionId: 's', sendAt: Date.now() + 3_600_000, armed: true, source: 'manual', message: 'Check the tests',
  } })} onClose={onClose} />)
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Edit' })) })
  const future = new Date(Date.now() + 2 * 86_400_000); future.setHours(18, 30, 0, 0)
  const fields = scheduledSendFields(future.getTime())
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Date'), fields.day) })
  await act(async () => { fireEvent.changeText(screen.getByLabelText('Scheduled Time'), fields.time) })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Save' })) })
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Scheduled Time').props.value).toBe('18:30')
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Save' })) })
  expect(schedule).toHaveBeenLastCalledWith(future.getTime())
  expect(onClose).toHaveBeenCalledTimes(1)
})

test.each(['manual', 'rate_limit'] as const)('cancelling a %s schedule returns to the setup panel without dismissing it', async (source) => {
  const onClose = jest.fn()
  const scheduled: ScheduledSend = { sessionId: 's', sendAt: Date.now() + 3_600_000, armed: true, source, message: 'Continue' }
  function Preview() {
    const [row, setRow] = useState<ScheduledSend | null>(scheduled)
    return <ScheduledSendPanel controls={controls({ scheduled: row,
      cancel: async () => setRow(source === 'rate_limit' ? { ...scheduled, armed: false } : null),
    })} onClose={onClose} />
  }
  await renderWithTheme(<Preview />)
  expect(screen.queryByLabelText('Scheduled Date')).toBeNull()
  expect(screen.getByText('Continue')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Cancel Scheduled Send' })) })
  expect(screen.getByLabelText('Scheduled Date')).toBeTruthy()
  expect(screen.getByLabelText('Scheduled Time')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Schedule Send' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Cancel Scheduled Send' })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
})
