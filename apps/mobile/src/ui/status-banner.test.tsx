import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { renderWithTheme } from '../test-render'
import { StatusBanner } from './status-banner'

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}))

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => { fireEvent.press(element) })
}

test('renders nothing without a message', async () => {
  await renderWithTheme(<StatusBanner message="" onDismiss={() => {}} />)
  expect(screen.queryByTestId('status-banner')).toBeNull()
})

test('shows the error under the header chrome with copy and close', async () => {
  const dismissed: string[] = []
  const message = 'Queued ACP message not found: user_3296d81d-13bd-4a4c-b29d-29f864a6089c'
  jest.mocked(Clipboard.setStringAsync).mockClear()
  await renderWithTheme(
    <StatusBanner
      message={message}
      onDismiss={() => { dismissed.push('closed') }}
    />,
  )

  expect(screen.getByTestId('status-banner')).toBeTruthy()
  expect(screen.getByText(/Queued ACP message not found/)).toBeTruthy()
  await press(screen.getByLabelText('Copy'))
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(message)
  await press(screen.getByLabelText('Close'))
  expect(dismissed).toEqual(['closed'])
})

test('translates copy and close', async () => {
  await renderWithTheme(
    <StatusBanner message="message failed" onDismiss={() => {}} />,
    'dark',
    'zh',
  )
  expect(screen.getByLabelText('复制')).toBeTruthy()
  expect(screen.getByLabelText('关闭')).toBeTruthy()
})
