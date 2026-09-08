import { expect, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { Pressable } from 'react-native'
import { Text } from '../ui/text'
import { useMobileLocale } from '../i18n/context'
import { MobileThemeProvider, useMobileTheme } from './context'

function ThemeProbe() {
  const { mode, setMode } = useMobileTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel="Set Light" onPress={() => setMode('light')}>
    <Text>{mode}</Text>
  </Pressable>
}

function LocaleProbe() {
  const { locale, setLocale, t } = useMobileLocale()
  return <Pressable accessibilityRole="button" accessibilityLabel="Set Chinese" onPress={() => setLocale('zh')}>
    <Text>{locale} · {t('Settings')}</Text>
  </Pressable>
}

test('changes the device theme immediately', async () => {
  await render(<MobileThemeProvider locale="en"><ThemeProbe /></MobileThemeProvider>)

  await fireEvent.press(screen.getByLabelText('Set Light'))
  expect(screen.getByText('light')).toBeTruthy()
})

test('changes the interface language immediately', async () => {
  await render(<MobileThemeProvider locale="en"><LocaleProbe /></MobileThemeProvider>)

  await fireEvent.press(screen.getByLabelText('Set Chinese'))
  expect(screen.getByText('zh · 设置')).toBeTruthy()
})
