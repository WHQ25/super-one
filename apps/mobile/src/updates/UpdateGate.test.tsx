import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MOBILE_UPDATE_DISMISSED_BUILD_KEY, MOBILE_UPDATE_LAST_CHECKED_KEY } from '../mobile-preferences'
import { createFakeUpdatePorts, fakeAndroidManifest } from '../preview/fake-update-ports'
import { ConnectedAppSettingsScreen } from '../screens/app-settings-screen'
import { renderWithTheme } from '../test-render'
import { UpdateGate } from './UpdateGate'
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_REENTRY_GUARD_MS } from './update-check-state'

const NOW = 1_800_000_000_000
let now = NOW

beforeEach(() => {
  now = NOW
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => { jest.restoreAllMocks() })

async function renderUpdater(values = new Map<string, string>()) {
  const ports = createFakeUpdatePorts({
    currentBuildCode: 37,
    manifest: fakeAndroidManifest({ version: '1.0.0', buildCode: 38, minSupportedBuildCode: 0 }),
  })
  const fetchManifest = jest.spyOn(ports, 'fetchManifest')
  const store = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value) },
  }
  await renderWithTheme(
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}>
      <UpdateGate ports={ports} store={store}>
        <ConnectedAppSettingsScreen />
      </UpdateGate>
    </SafeAreaProvider>,
  )
  return { values, fetchManifest }
}

test.each(['Later', 'Close Dialog'])('manual checking immediately reopens an update dismissed with %s', async (dismissLabel) => {
  const { values, fetchManifest } = await renderUpdater()
  expect(screen.getByTestId('update-next-build')).toHaveTextContent('1.0.0 (38)')

  await act(async () => { fireEvent.press(screen.getByRole('button', { name: dismissLabel })) })
  expect(screen.queryByText('Update available')).toBeNull()
  expect(values.get(MOBILE_UPDATE_DISMISSED_BUILD_KEY)).toBe('38')

  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Check for updates' })) })
  expect(fetchManifest).toHaveBeenCalledTimes(2)
  expect(screen.getByTestId('update-next-build')).toHaveTextContent('1.0.0 (38)')
  // Manual checks must not erase the dismissal used by automatic checks.
  expect(values.get(MOBILE_UPDATE_DISMISSED_BUILD_KEY)).toBe('38')
})

test('manual checking reopens a persisted dismissal after the re-entry guard has elapsed', async () => {
  const { fetchManifest } = await renderUpdater(new Map([
    [MOBILE_UPDATE_DISMISSED_BUILD_KEY, '38'],
    [MOBILE_UPDATE_LAST_CHECKED_KEY, String(NOW - UPDATE_REENTRY_GUARD_MS)],
  ]))
  expect(fetchManifest).not.toHaveBeenCalled()

  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Check for updates' })) })
  expect(fetchManifest).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('update-next-build')).toHaveTextContent('1.0.0 (38)')
})

test('automatic foreground checks still respect a dismissed build', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener)
    return { remove: () => { listeners.delete(listener) } }
  })
  const { fetchManifest } = await renderUpdater(new Map([[MOBILE_UPDATE_DISMISSED_BUILD_KEY, '38']]))
  expect(fetchManifest).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Update available')).toBeNull()

  now += UPDATE_CHECK_INTERVAL_MS
  await act(async () => { for (const listener of listeners) listener('active') })
  expect(fetchManifest).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Update available')).toBeNull()
})
