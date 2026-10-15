import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionHandoffComposer } from './SessionHandoffComposer'

test('offers the handoff with its reasons, and approves or dismisses it', async () => {
  const onApprove = jest.fn()
  const onDismiss = jest.fn()
  await renderWithTheme(<SessionHandoffComposer onApprove={onApprove} onDismiss={onDismiss} />)
  expect(screen.getByRole('header', { name: 'Handoff to New Session' })).toBeTruthy()
  expect(screen.getByText(/Collaboration carries over/)).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Approve' })) })
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Dismiss' })) })
  expect([onApprove.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
})

test('reads in Chinese', async () => {
  await renderWithTheme(<SessionHandoffComposer onApprove={() => {}} onDismiss={() => {}} />, 'light', 'zh')
  expect(screen.getByText('移交到新会话')).toBeTruthy()
  expect(screen.getByText('协作关系保留：父会话、子会话和关联会话都会转到新会话。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '批准' })).toBeTruthy()
})
