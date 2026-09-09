import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ConnectionStatusIndicator } from './connection-status'
import { WIFI_CYCLE_FRAME_MS } from './wifi-cycle-icon'

jest.mock('./use-icon-motion', () => ({ useIconMotion: () => true }))
beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

test('searching the local network cycles wifi strength instead of spinning', async () => {
  await renderWithTheme(<ConnectionStatusIndicator status="searchingLan" />)
  expect(screen.getByLabelText('Searching local network…')).toBeTruthy()
  expect(screen.getByTestId('wifi-cycle-zero')).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(WIFI_CYCLE_FRAME_MS) })
  expect(screen.getByTestId('wifi-cycle-low')).toBeTruthy()
})

test('connecting still spins and does not cycle wifi', async () => {
  await renderWithTheme(<ConnectionStatusIndicator status="connecting" />)
  expect(screen.getByLabelText('Connecting…')).toBeTruthy()
  expect(screen.queryByTestId('wifi-cycle-zero')).toBeNull()
})
