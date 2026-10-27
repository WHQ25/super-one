/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ANDROID_PHONE_REFERENCE_MODEL, type DeviceDescriptor, type DeviceState } from '@superone/shared/device'

vi.mock('./device-video', () => ({
  preferredDevicePreviewMode: () => 'native-h264',
  DeviceFrameRenderer: class { push() {} close() {} },
}))
// WebGL is a real browser boundary jsdom does not have; the switch is what is under test.
const modelViews = vi.hoisted(() => ({ mounted: 0, folds: [] as unknown[], rotations: [] as number[] }))
vi.mock('./DeviceModelView', () => ({
  DeviceModelView: ({ model, fold, rotationDegrees }: { model: string; fold?: unknown; rotationDegrees: number }) => {
    useEffect(() => { modelViews.mounted += 1 }, [])
    modelViews.folds.push(fold)
    modelViews.rotations.push(rotationDegrees)
    return <div data-testid="device-model-view">{model}</div>
  },
}))

import { resetDeviceSurfaces } from './device-surface'
import { deviceModelKey } from './device-3d'
import { DeviceStage } from './DeviceStage'
import { IOS_SIMULATOR_CHROME } from '../../../../test/fixtures/ios-simulator'

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
      deviceEnvironment: vi.fn(async () => { throw new Error("no environment in this test") }),
      onDeviceEnvironmentChanged: vi.fn(() => () => {}),
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

  it('gives the toolbar back the keys the drawn shell carried once the 3D body is on screen', async () => {
    const button = (name: string, input: 'lock' | 'volume-up' | 'volume-down') => ({
      name, title: name, anchor: 'left' as const, offset: { across: 8, along: 200 },
      hoverOffset: { across: 3, along: 200 }, width: 16, height: 64, image: `${name}.png`, input,
    })
    window.environment.iosSimulatorChrome = vi.fn(async () => ({
      ...IOS_SIMULATOR_CHROME,
      buttons: [button('power', 'lock'), button('volume-up', 'volume-up'), button('volume-down', 'volume-down')],
    }))
    renderStage(simulator('iPhone 17 Pro'))
    const modes = await screen.findByRole('tablist', { name: 'View Mode' })
    // Flat: the body's own buttons press, so the toolbar leaves them out.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lock' })).toBeNull())

    fireEvent.mouseDown(within(modes).getByRole('tab', { name: '3D' }))

    // The 3D body's buttons are part of the model and do not press.
    await screen.findByTestId('device-model-view')
    for (const name of ['Lock', 'Volume Down', 'Volume Up']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('bends the 3D body through a panel swap rather than loading it again', async () => {
    localStorage.setItem('superone.device.view3d', 'true')
    let pushState: (state: DeviceState) => void = () => {}
    window.environment.onDeviceState = vi.fn((_id: string, listener: (state: DeviceState) => void) => {
      pushState = listener
      return () => {}
    })
    // The flat shell's artwork for the newly lit panel never answers here: the body must not wait for it.
    window.environment.iosSimulatorChrome = vi.fn(() => new Promise<never>(() => {}))
    const device = simulator('iPhone 17 Pro')
    const closed = { hingeDegrees: 0, tent: false, laptop: false, panel: 'cover' as const, panelRotation: 0 as const }
    renderStage(device, { ...ready(device), ios: { previewMode: 'native-h264', hardwareKeyboardConnected: true, hardwareKeyboardAvailable: true, fold: closed } })
    await screen.findByTestId('device-model-view')
    modelViews.mounted = 0

    act(() => pushState({ ...ready(device), ios: { previewMode: 'native-h264', hardwareKeyboardConnected: true, hardwareKeyboardAvailable: true,
      fold: { ...closed, hingeDegrees: 180, panel: 'inner', panelRotation: 90 } } }))

    expect(screen.getByTestId('device-model-view')).toBeInTheDocument()
    expect(modelViews.mounted).toBe(0)
    expect(modelViews.folds.at(-1)).toEqual(expect.objectContaining({ hingeDegrees: 180, panel: 'inner' }))
  })

  it('stands the 3D body in a held form before the guest takes it, picture left on the old panel', async () => {
    localStorage.setItem('superone.device.view3d', 'true')
    const device = simulator('iPhone 17 Pro')
    const open = { hingeDegrees: 180, tent: false, laptop: false, panel: 'inner' as const, panelRotation: 270 as const }
    renderStage(device, { ...ready(device), ios: { previewMode: 'native-h264', hardwareKeyboardConnected: true, hardwareKeyboardAvailable: true, fold: open } })
    // The guest never answers here, so the body stays wherever it was sent.
    window.environment.deviceConfigure = vi.fn(() => new Promise<never>(() => {}))
    await screen.findByTestId('device-model-view')
    expect(modelViews.rotations.at(-1)).toBe(270)

    fireEvent.click(screen.getByRole('button', { name: 'Hinge Angle' }))
    const slider = await screen.findByRole('slider', { name: 'Hinge Angle' })
    // Dragged through, a form only bends the body: it stays open, as held.
    for (const value of ['100', '45']) fireEvent.change(slider, { target: { value } })
    expect(modelViews.folds.at(-1)).toEqual({ ...open, hingeDegrees: 45 })
    expect(modelViews.rotations.at(-1)).toBe(270)
    // Sent there, a tent: the cover turned to the camera and held a quarter clockwise, as the host will.
    fireEvent.pointerUp(slider)
    expect(modelViews.folds.at(-1)).toEqual({ ...open, hingeDegrees: 45, facing: 'cover' })
    expect(modelViews.rotations.at(-1)).toBe((90 + 270) % 360)
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
