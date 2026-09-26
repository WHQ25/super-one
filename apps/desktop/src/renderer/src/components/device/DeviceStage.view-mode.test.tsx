/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ANDROID_PHONE_REFERENCE_MODEL, type DeviceDescriptor, type DeviceState } from '@superone/shared/device'

vi.mock('./device-video', () => ({
  preferredDevicePreviewMode: () => 'native-h264',
  DeviceFrameRenderer: class { push() {} close() {} },
}))
// WebGL is a real browser boundary jsdom does not have; the switch is what is under test.
vi.mock('./DeviceModelView', () => ({
  DeviceModelView: ({ model }: { model: string }) => <div data-testid="device-model-view">{model}</div>,
}))

import { resetDeviceSurfaces } from './device-surface'
import { deviceModelKey } from './device-3d'
import { DeviceStage } from './DeviceStage'

function simulator(model: string): DeviceDescriptor {
  return {
    id: `ios:${model}`,
    provider: 'ios-sim',
    platform: 'ios',
    name: model,
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    model,
    platformVersion: 'iOS 26.5',
    versionRank: 26005,
    running: true,
    available: true,
  }
}

function androidPhone(id = 'android:avd:Medium_Phone'): DeviceDescriptor {
  return {
    ...simulator('Medium Phone'), id, provider: 'android', platform: 'android',
    kind: 'phone', kindName: 'Android Phone', platformVersion: 'Android 16',
  }
}

function ready(device: DeviceDescriptor): DeviceState {
  return {
    deviceId: device.id,
    owner: 'session-1',
    device,
    phase: 'ready',
    interactive: true,
    orientation: 'portrait',
  }
}

function renderStage(device: DeviceDescriptor, state = ready(device)) {
  return render(
    <DeviceStage
      sessionId="session-1"
      devices={[device]}
      device={device}
      sessionState={state}
      busy={false}
      checking={false}
      launching={false}
      onSelectDevice={vi.fn()}
      onLaunchDevice={vi.fn()}
      onDetach={vi.fn()}
      onTerminate={vi.fn()}
    />,
  )
}

const setupApp = window.app

beforeEach(() => {
  resetDeviceSurfaces()
  localStorage.clear()
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorChrome: vi.fn(async () => null),
      deviceInput: vi.fn(async () => ({ ok: true })),
      onDeviceFrame: vi.fn(() => () => {}),
      onDeviceRotateGesture: vi.fn(() => () => {}),
      onDeviceState: vi.fn(() => () => {}),
      openDeviceStream: vi.fn(),
      closeDeviceStream: vi.fn(),
    },
  })
  // Wrap the setup file's stub rather than replace it; other controls read settings off it.
  const listDeviceModels = vi.fn(async () => ['iPhone 17 Pro', ANDROID_PHONE_REFERENCE_MODEL])
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: new Proxy({}, { get: (_target, key) => (key === 'listDeviceModels' ? listDeviceModels : Reflect.get(setupApp, key)) }),
  })
})

describe('device view mode switch', () => {
  it('switches a device with a 3D body between flat and 3D, and remembers the choice', async () => {
    renderStage(simulator('iPhone 17 Pro'))
    const modes = await screen.findByRole('tablist', { name: 'View Mode' })
    expect(within(modes).getByRole('tab', { name: '2D' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('device-model-view')).toBeNull()

    // Radix activates tabs on mousedown.
    fireEvent.mouseDown(within(modes).getByRole('tab', { name: '3D' }))

    expect(within(modes).getByRole('tab', { name: '3D' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('device-model-view')).toHaveTextContent('iPhone 17 Pro')
    expect(localStorage.getItem('superone.device.view3d')).toBe('true')

    fireEvent.mouseDown(within(modes).getByRole('tab', { name: '2D' }))
    expect(screen.queryByTestId('device-model-view')).toBeNull()
    expect(localStorage.getItem('superone.device.view3d')).toBe('false')
  })

  it('offers no switch for a device this machine has no 3D body for', async () => {
    renderStage(simulator('iPhone SE 3rd generation'))
    // Let the availability lookup answer before asserting the switch stays away.
    await screen.findByRole('button', { name: /iPhone SE/ })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('tablist', { name: 'View Mode' })).toBeNull()
  })

  it('uses the Pixel reference shell for an ordinary Android phone AVD', async () => {
    renderStage(androidPhone())
    const modes = await screen.findByRole('tablist', { name: 'View Mode' })
    fireEvent.mouseDown(within(modes).getByRole('tab', { name: '3D' }))
    expect(await screen.findByTestId('device-model-view')).toHaveTextContent(ANDROID_PHONE_REFERENCE_MODEL)
  })

  it('does not offer the stand-in to physical phones or other AVD kinds', () => {
    expect(deviceModelKey(androidPhone('android:emulator-5554'))).toBeNull()
    expect(deviceModelKey({ ...androidPhone(), kind: 'foldable' })).toBeNull()
    expect(deviceModelKey({ ...androidPhone(), kind: 'tablet' })).toBeNull()
  })

  it('falls back to the flat view for a landscape Android framebuffer', async () => {
    localStorage.setItem('superone.device.view3d', 'true')
    const device = androidPhone()
    renderStage(device, { ...ready(device), orientation: 'landscape-right' })
    await screen.findByRole('button', { name: /Medium Phone/ })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('device-model-view')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'View Mode' })).toBeNull()
  })
})
