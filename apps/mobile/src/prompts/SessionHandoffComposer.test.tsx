import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionHandoffComposer } from './SessionHandoffComposer'

test('offers the handoff with its reasons, and approves or dismisses it', async () => {
  const onApprove = jest.fn()
  const onDismiss = jest.fn()
  await renderWithTheme(<SessionHandoffComposer onApprove={onApprove} onDismiss={onDismiss} />)
  expect(screen.getByRole('header', { name: 'Hand Off to New Session' })).toBeTruthy()
  expect(screen.getByText('Work seamlessly with all of this session’s collaborators.')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Approve' })) })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Dismiss' })) })
  expect([onApprove.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
})

test('reads in Chinese', async () => {
  await renderWithTheme(<SessionHandoffComposer onApprove={() => {}} onDismiss={() => {}} />, 'light', 'zh')
  expect(screen.getByText('移交到新会话')).toBeTruthy()
  expect(screen.getByText('与原会话的所有协作者无缝协作。')).toBeTruthy()
  expect(screen.getByText('自动引用当前会话，agent 可按需读取完整上下文。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '批准' })).toBeTruthy()
})
