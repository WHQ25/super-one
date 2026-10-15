import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionHandoffComposer } from './SessionHandoffComposer'

test('offers the handoff with its reasons, and approves or dismisses it', async () => {
  const onApprove = jest.fn()
  const onDismiss = jest.fn()
  await renderWithTheme(<SessionHandoffComposer onApprove={onApprove} onDismiss={onDismiss} />)
  expect(screen.getByRole('header', { name: 'Hand Off to New Session' })).toBeTruthy()
  expect(screen.getByText('Collaborate with all of the original session’s collaborators as usual.')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Approve' })) })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Dismiss' })) })
  expect([onApprove.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
})

test('reads in Chinese', async () => {
  await renderWithTheme(<SessionHandoffComposer onApprove={() => {}} onDismiss={() => {}} />, 'light', 'zh')
  expect(screen.getByText('移交到新会话')).toBeTruthy()
  expect(screen.getByText('可以和原会话的所有协作者正常协作。')).toBeTruthy()
  expect(screen.getByText('新会话自动引用当前会话，上下文保留，agent 可按需读取。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '批准' })).toBeTruthy()
})
