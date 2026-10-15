import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { AppSettingsScreen } from './app-settings-screen'

test('shows device theme and language preferences', async () => {
  await renderWithTheme(<AppSettingsScreen />)

  expect(screen.getByText('Appearance')).toBeTruthy()
  expect(screen.getByText('Theme')).toBeTruthy()
  expect(screen.getByText('Dark')).toBeTruthy()
  expect(screen.getByText('Language & Region')).toBeTruthy()
  expect(screen.getByText('Language')).toBeTruthy()
  expect(screen.getByText('English')).toBeTruthy()
})

test('renders the settings surface in Chinese', async () => {
  await renderWithTheme(<AppSettingsScreen />, 'dark', 'zh')

  expect(screen.getByText('外观')).toBeTruthy()
  expect(screen.getByText('主题')).toBeTruthy()
  expect(screen.getByText('深色')).toBeTruthy()
  expect(screen.getByText('语言与地区')).toBeTruthy()
  expect(screen.getByText('语言')).toBeTruthy()
})

test('keeps the build label and update action available in the compact card', async () => {
  const onCheckForUpdates = jest.fn()
  await renderWithTheme(<AppSettingsScreen update={{ version: '1.0.0', buildCode: 37, onCheckForUpdates }} />)

  expect(screen.getByTestId('settings-build')).toHaveTextContent('1.0.0 (37)')
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Check for updates' })) })
  expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
})

test('disables checking while an update check is running', async () => {
  const onCheckForUpdates = jest.fn()
  await renderWithTheme(<AppSettingsScreen update={{ version: '1.0.0', buildCode: 37, checking: true, onCheckForUpdates }} />)

  const button = screen.getByRole('button', { name: 'Checking…' })
  expect(button).toBeDisabled()
  await act(async () => { fireEvent.press(button) })
  expect(onCheckForUpdates).not.toHaveBeenCalled()
})

test('turns the long-session hint on and off and hides its threshold while off', async () => {
  const onChange = jest.fn()
  const settings = (enabled: boolean) => <AppSettingsScreen continuation={{ value: { enabled, minContextTokens: 300_000 }, onChange }} />
  await renderWithTheme(settings(true))
  expect(screen.getByText('Long Session Threshold')).toBeTruthy()
  expect(screen.getByText('300K')).toBeTruthy()
  await act(async () => { fireEvent(screen.getByLabelText('Suggest Continuing Long Sessions'), 'valueChange', false) })
  expect(onChange).toHaveBeenCalledWith({ enabled: false })

  await renderWithTheme(settings(false))
  expect(screen.queryByText('Long Session Threshold')).toBeNull()
})
