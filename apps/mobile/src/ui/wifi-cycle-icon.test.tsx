import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { WIFI_CYCLE_FRAME_MS, WifiCycleIcon } from './wifi-cycle-icon'

const mockMotion = jest.fn(() => true)
jest.mock('./use-icon-motion', () => ({ useIconMotion: () => mockMotion() }))

beforeEach(() => {
  mockMotion.mockReturnValue(true)
  jest.useFakeTimers()
})
afterEach(() => { jest.useRealTimers() })

const icon = <WifiCycleIcon size={13} color="#a1a1a1" />

test('cycles wifi-zero → wifi-low → wifi-high → wifi every 250ms', async () => {
  await renderWithTheme(icon)
  expect(screen.getByTestId('wifi-cycle-zero')).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS) })
  expect(screen.getByTestId('wifi-cycle-low')).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS) })
  expect(screen.getByTestId('wifi-cycle-high')).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS) })
  expect(screen.getByTestId('wifi-cycle-full')).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS) })
  expect(screen.getByTestId('wifi-cycle-zero')).toBeTruthy()
})

test('stays on wifi-zero when motion is disabled', async () => {
  mockMotion.mockReturnValue(false)
  await renderWithTheme(icon)
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS * 4) })
  expect(screen.getByTestId('wifi-cycle-zero')).toBeTruthy()
  expect(screen.queryByTestId('wifi-cycle-low')).toBeNull()
})
