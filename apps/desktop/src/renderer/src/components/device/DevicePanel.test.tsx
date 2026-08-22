/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceDescriptor, DeviceSessionState } from '@superone/shared/device'

vi.mock('./device-video', () => ({
  preferredDevicePreviewMode: () => 'native-h264',
  DeviceFrameRenderer: class {
    push() {}
    close() {}
  },
}))

import { DevicePanel } from './DevicePanel'
import { useDeviceTabActions } from './device-tab-actions'

function device(overrides: Partial<DeviceDescriptor> & Pick<DeviceDescriptor, 'id' | 'name'>): DeviceDescriptor {
  return {
    provider: 'ios-sim',
    platform: 'ios',
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    model: overrides.name,
    platformVersion: 'iOS 26.0',
    versionRank: 26000,
    running: false,
    available: true,
    ...overrides,
  }
}

const RECENT = device({ id: 'ios-sim:p17-26', name: 'iPhone 17 Pro' })
const OTHER = device({ id: 'ios-sim:air-26', name: 'iPhone Air' })

function ready(target: DeviceDescriptor): DeviceSessionState {
  return {
    sessionId: 'session-1',
    device: target,
    phase: 'ready',
    interactive: true,
    orientation: 'portrait',
    ios: {
      previewMode: 'native-h264',
      hardwareKeyboardConnected: true,
      hardwareKeyboardAvailable: true,
    },
  }
}

function stubEnvironment(devices: DeviceDescriptor[]) {
  const deviceBind = vi.fn(async (_sessionId: string, deviceId: string) =>
    ready(devices.find((entry) => entry.id === deviceId)!))
  const deviceBoot = vi.fn(async (_sessionId: string, deviceId: string) =>
    ready(devices.find((entry) => entry.id === deviceId)!))
  const deviceDetach = vi.fn(async () => null)
  // The setup file installs a get-trap Proxy that ignores its target, so stubs have
  // to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorStatus: vi.fn(async () => ({ supported: true })),
      deviceList: vi.fn(async () => devices),
      deviceBind,
      deviceBoot,
      deviceDetach,
      iosSimulatorChrome: vi.fn(async () => null),
      deviceInput: vi.fn(async () => ({ ok: true })),
      onDeviceFrame: vi.fn(() => () => {}),
      onDeviceRotateGesture: vi.fn(() => () => {}),
      onDeviceSessionState: vi.fn(() => () => {}),
      openDeviceStream: vi.fn(),
      closeDeviceStream: vi.fn(),
    },
  })
  return { deviceBind, deviceBoot, deviceDetach }
}

describe('iOS Simulator panel device switching', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function pickFromMenu(user: ReturnType<typeof userEvent.setup>, trigger: RegExp, item: RegExp) {
    await user.click(await screen.findByRole('button', { name: trigger }))
    await user.click(await screen.findByRole('menuitem', { name: item }))
  }

  it('draws a simulator chosen from the menu without booting it', async () => {
    const user = userEvent.setup()
    const { deviceBoot, deviceBind } = stubEnvironment([RECENT, OTHER])

    render(<DevicePanel sessionId="session-1" />)
    await pickFromMenu(user, /Choose a Device/, /iPhone Air · iOS 26.0/)

    // The body and its Launch button, and nothing started behind them: choosing is
    // aiming the panel, not pulling the trigger.
    expect(await screen.findByRole('button', { name: /iPhone Air · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
    expect(deviceBoot).not.toHaveBeenCalled()
    expect(deviceBind).not.toHaveBeenCalled()
  })

  it('lets go of the simulator it holds before pointing at another', async () => {
    const booted = { ...RECENT, running: true }
    localStorage.setItem('superone.device.recentIds', JSON.stringify([booted.id]))
    const user = userEvent.setup()
    const { deviceBind, deviceDetach } = stubEnvironment([booted, OTHER])

    render(<DevicePanel sessionId="session-1" />)
    await waitFor(() => expect(deviceBind).toHaveBeenCalledWith('session-1', booted.id))

    await pickFromMenu(user, /iPhone 17 Pro · iOS 26.0/, /iPhone Air · iOS 26.0/)

    // Otherwise the panel would draw one device while Disconnect and Shut Down still
    // pointed at the one it never released.
    await waitFor(() => expect(deviceDetach).toHaveBeenCalledWith('session-1'))
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })
})

describe('iOS Simulator panel reopening', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the last simulator this machine launched without booting it', async () => {
    localStorage.setItem('superone.device.recentIds', JSON.stringify([RECENT.id, OTHER.id]))
    const { deviceBind, deviceBoot } = stubEnvironment([RECENT, OTHER])

    render(<DevicePanel sessionId="session-1" />)

    // Named in the header and drawn on the stage, but still shut down: opening the
    // panel is not the same as claiming a simulator.
    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
    expect(deviceBoot).not.toHaveBeenCalled()
    expect(deviceBind).not.toHaveBeenCalled()
  })

  it('steps straight back into that simulator when it is already running and unclaimed', async () => {
    const booted = { ...RECENT, running: true }
    localStorage.setItem('superone.device.recentIds', JSON.stringify([booted.id]))
    const { deviceBind, deviceBoot } = stubEnvironment([booted, OTHER])

    render(<DevicePanel sessionId="session-1" />)

    await waitFor(() => expect(deviceBind).toHaveBeenCalledWith('session-1', booted.id))
    // Attaching is free; booting is not. Nothing was started.
    expect(deviceBoot).not.toHaveBeenCalled()
  })

  it('leaves a running simulator alone when another session already holds it', async () => {
    const taken = { ...RECENT, running: true, boundSessionId: 'session-2' }
    localStorage.setItem('superone.device.recentIds', JSON.stringify([taken.id]))
    const { deviceBind } = stubEnvironment([taken, OTHER])

    render(<DevicePanel sessionId="session-1" />)

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled()
    expect(deviceBind).not.toHaveBeenCalled()
  })

  it('frames the environment probe in a device body rather than a bare spinner', async () => {
    let answer: (() => void) | undefined
    const held = new Promise<void>((resolve) => { answer = resolve })
    stubEnvironment([RECENT])
    const environment = window.environment as unknown as { iosSimulatorStatus: () => Promise<unknown> }
    environment.iosSimulatorStatus = async () => { await held; return { supported: true } }

    render(<DevicePanel sessionId="session-1" />)

    // The drawn shell paints its glass black and its side keys #4a4a54 — a body is
    // on screen before simctl has said a word.
    expect(await screen.findByText('Checking the local device environment…')).toBeInTheDocument()
    expect(document.querySelector('.bg-black')).not.toBeNull()

    answer?.()
    await waitFor(() => expect(screen.queryByText('Checking the local device environment…')).toBeNull())
  })

  it('keeps the device on screen across a manual refresh', async () => {
    localStorage.setItem('superone.device.recentIds', JSON.stringify([RECENT.id]))
    stubEnvironment([RECENT, OTHER])

    render(<DevicePanel sessionId="session-1" />)
    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()

    // Through the seam the dockview tab presses, since the tab lives outside this
    // panel. Re-reading the list is how a simulator Xcode just created shows up;
    // losing your place for it — back to "Choose a Simulator" — was the bug.
    await waitFor(() =>
      expect(useDeviceTabActions.getState().bySession['session-1']).toBeDefined())
    act(() => { useDeviceTabActions.getState().bySession['session-1']!.refresh() })

    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })

  it('takes its refresh action off the tab when the panel goes away', async () => {
    stubEnvironment([RECENT])

    const view = render(<DevicePanel sessionId="session-1" />)
    await waitFor(() =>
      expect(useDeviceTabActions.getState().bySession['session-1']).toBeDefined())

    view.unmount()

    // Otherwise a closed panel leaves a live button on a tab that outlives it.
    expect(useDeviceTabActions.getState().bySession['session-1']).toBeUndefined()
  })

  it('falls back to the picker when nothing has been launched on this machine', async () => {
    stubEnvironment([RECENT, OTHER])

    render(<DevicePanel sessionId="session-1" />)

    // The header trigger and the one on the empty stage. `waitFor`, not `findAll`:
    // the header's is already there during the environment probe, so a first match
    // proves nothing about the stage having settled.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Choose a Device/ })).toHaveLength(2))
  })
})
