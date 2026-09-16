import { afterEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { DeviceEventEmitter, Platform } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { AnchoredMenu, MenuTextInput } from './anchored-menu'

const originalOS = Platform.OS
afterEach(() => { Platform.OS = originalOS })

const ANCHOR = { x: 12, y: 700, width: 80, height: 32 }
const keyboardEvent = (screenY: number, height: number) => ({
  duration: 0, easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY, width: 400, height },
  startCoordinates: { screenX: 0, screenY: 850, width: 400, height: 0 },
})
const keyboard = (name: string, screenY: number, height: number) =>
  act(async () => { DeviceEventEmitter.emit(name, keyboardEvent(screenY, height)) })

/** The surface mounts in the theme provider's `MenuHost`, above anything
 * `renderWithTheme` would wrap, so the safe-area provider has to sit outside it. */
const renderMenu = async (onDismiss: () => void, remeasure?: () => void) => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <MobileThemeProvider colorScheme="dark" locale="en">
      <AnchoredMenu anchor={ANCHOR} title="Models" onDismiss={onDismiss} remeasure={remeasure}>
        <MenuTextInput accessibilityLabel="Search models" />
      </AnchoredMenu>
    </MobileThemeProvider>
  </SafeAreaProvider>,
)

test('closes when the keyboard comes up under a composer field', async () => {
  const onDismiss = jest.fn()
  await renderMenu(onDismiss)
  expect(screen.getByRole('header', { name: 'Models' })).toBeTruthy()

  await keyboard('keyboardDidShow', 500, 350)
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('closes when the keyboard the menu opened over goes away', async () => {
  Platform.OS = 'ios'
  const onDismiss = jest.fn()
  await renderMenu(onDismiss)

  await keyboard('keyboardWillHide', 850, 0)
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('stays open around the keyboard its own search field raised, re-measuring the trigger once it settles', async () => {
  Platform.OS = 'ios'
  const onDismiss = jest.fn()
  const remeasure = jest.fn()
  await renderMenu(onDismiss, remeasure)

  await act(async () => { fireEvent(screen.getByLabelText('Search models'), 'focus') })
  await keyboard('keyboardDidShow', 500, 350)
  expect(remeasure).toHaveBeenCalledTimes(1)
  // The composer is still moving at `Will`; only the settled frame is measured.
  await keyboard('keyboardWillHide', 850, 0)
  expect(remeasure).toHaveBeenCalledTimes(1)
  await keyboard('keyboardDidHide', 850, 0)
  expect(remeasure).toHaveBeenCalledTimes(2)
  expect(onDismiss).not.toHaveBeenCalled()

  // Ownership ends with that keyboard; the next one is somebody else's.
  await keyboard('keyboardDidShow', 500, 350)
  expect(onDismiss).toHaveBeenCalledTimes(1)
})
