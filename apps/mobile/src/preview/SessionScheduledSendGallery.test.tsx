import { expect, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionScheduledSendGallery } from './SessionScheduledSendGallery'

test('renders scheduled project, pinned, selected and running rows in a narrow preview', async () => {
  await renderWithTheme(<SessionScheduledSendGallery width={240} />)
  expect(screen.getAllByTestId('session-scheduled-send')).toHaveLength(6)
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Toggle scheduled sends' })) })
  expect(screen.queryAllByTestId('session-scheduled-send')).toHaveLength(0)
  expect(screen.getByText('No scheduled send')).toBeTruthy()
})

test('keeps collaboration expansion reachable beside a scheduled icon', async () => {
  await renderWithTheme(<SessionScheduledSendGallery width={240} />)
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Show sessions started by Collaboration parent' })) })
  expect(screen.getByText('Scheduled child session')).toBeTruthy()
  expect(screen.getAllByTestId('session-scheduled-send')).toHaveLength(7)
})
