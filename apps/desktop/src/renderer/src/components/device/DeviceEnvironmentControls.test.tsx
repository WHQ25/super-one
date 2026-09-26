/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceEnvironmentAction, DeviceEnvironmentState } from '@superone/shared/device-environment'
import { ANDROID_FONT_SCALES, IOS_CONTENT_SIZES } from '@superone/shared/device-environment'
import { DeviceEnvironmentControls } from './DeviceEnvironmentControls'

const ios: DeviceEnvironmentState = {
  deviceId: 'ios-sim:sim-1', appearance: 'dark', locationReadable: false,
  textSize: 'large', textSizeSupported: true,
  textSizeOptions: [...IOS_CONTENT_SIZES],
  canClearLocation: true, postures: [], posture: null,
}
const android: DeviceEnvironmentState = {
  deviceId: 'android:avd:Fold', appearance: 'light', locationReadable: false,
  textSize: '1.3', textSizeSupported: true,
  textSizeOptions: [...ANDROID_FONT_SCALES],
  canClearLocation: false, postures: [{ id: 2, label: 'half opened' }], posture: null,
}

function show(state: DeviceEnvironmentState) {
  const read = vi.fn(async () => state)
  const configure = vi.fn(async (_id: string, action: DeviceEnvironmentAction) => ({
    status: 'applied' as const, deviceId: state.deviceId, action, state,
  }))
  const subscribe = vi.fn(() => () => {})
  render(<DeviceEnvironmentControls
    deviceId={state.deviceId} provider={state.deviceId.startsWith('ios') ? 'ios-sim' : 'android'}
    disabled={false} read={read} configure={configure} subscribe={subscribe}
  />)
  return { read, configure }
}

describe('device environment controls', () => {
  it('offers iOS clear and sends latitude then longitude as typed values', async () => {
    const { configure } = show(ios)
    await userEvent.click(screen.getByRole('button', { name: 'Device Environment' }))
    await screen.findByRole('button', { name: 'Clear Location' })
    await userEvent.type(screen.getByRole('textbox', { name: 'Latitude' }), '31.2')
    await userEvent.type(screen.getByRole('textbox', { name: 'Longitude' }), '121.5')
    await userEvent.click(screen.getByRole('button', { name: 'Set Location' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', {
      kind: 'location', latitude: 31.2, longitude: 121.5,
    }))
  })

  it('uses a refresh icon and exposes the full iOS text-size slider', async () => {
    const { read, configure } = show(ios)
    await userEvent.click(screen.getByRole('button', { name: 'Device Environment' }))
    const slider = await screen.findByRole('slider', { name: 'System Text Size' })
    expect(slider).toHaveAttribute('max', '11')
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByRole('textbox', { name: 'Longitude' })).toHaveAttribute('inputmode', 'decimal')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Settings' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    fireEvent.change(slider, { target: { value: '11' } })
    fireEvent.keyUp(slider)
    await waitFor(() => expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', {
      kind: 'text_size', value: 'accessibility-extra-extra-extra-large',
    }))
  })

  it('uses a tab switcher for appearance and the Android runtime scale range', async () => {
    const { configure } = show(android)
    await userEvent.click(screen.getByRole('button', { name: 'Device Environment' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Dark' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('android:avd:Fold', {
      kind: 'appearance', value: 'dark',
    }))
    expect(screen.getByRole('slider', { name: 'System Text Size' })).toHaveAttribute('max', '6')
  })

  it('shows only queried Android postures and no clear-location action', async () => {
    const { configure } = show(android)
    await userEvent.click(screen.getByRole('button', { name: 'Device Environment' }))
    await screen.findByRole('button', { name: 'half opened' })
    expect(screen.queryByRole('button', { name: 'Clear Location' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'half opened' }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith('android:avd:Fold', { kind: 'posture', id: 2 }))
    expect(screen.getByText('Current posture cannot be read from the emulator console.')).toBeInTheDocument()
  })

  it('hides controls on physical and mirrored devices', () => {
    const read = vi.fn(async () => ios)
    const { rerender } = render(<DeviceEnvironmentControls deviceId="ios-mirror:phone" provider="ios-mirror"
      disabled={false} read={read} />)
    expect(screen.queryByRole('button', { name: 'Device Environment' })).toBeNull()
    rerender(<DeviceEnvironmentControls deviceId="android:physical-serial" provider="android"
      disabled={false} read={read} />)
    expect(screen.queryByRole('button', { name: 'Device Environment' })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
