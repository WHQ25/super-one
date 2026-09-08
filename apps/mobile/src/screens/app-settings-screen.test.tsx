import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
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
