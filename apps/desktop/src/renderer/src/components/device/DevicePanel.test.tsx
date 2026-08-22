/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceDescriptor, DeviceState } from '@superone/shared/device'

vi.mock('./device-video', () => ({
  preferredDevicePreviewMode: () => 'native-h264',
  DeviceFrameRenderer: class {
    push() {}
    close() {}
  },
}))

import { useDeviceInstanceStore } from '@/stores/device-instances'
import { DevicePanel } from './DevicePanel'
import { useDeviceTabActions } from './device-tab-actions'

/**
 * A tab of `session-1`, since that is what the panel is now: an instance, not a
 * session. The id is generated rather than fixed so two of them in one test are two
 * genuinely separate tabs.
 */
let instanceId = ''
function openInstance(deviceId: string | null = null): string {
  instanceId = useDeviceInstanceStore.getState().open('session-1', deviceId)
  return instanceId
}

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

function ready(target: DeviceDescriptor): DeviceState {
  return {
    deviceId: target.id,
    owner: 'session-1',
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
      deviceSetupOptions: vi.fn(async () => []),
      deviceBind,
      deviceBoot,
      deviceDetach,
      iosSimulatorChrome: vi.fn(async () => null),
      deviceInput: vi.fn(async () => ({ ok: true })),
      onDeviceFrame: vi.fn(() => () => {}),
      onDeviceRotateGesture: vi.fn(() => () => {}),
      onDeviceState: vi.fn(() => () => {}),
      onAnyDeviceState: vi.fn(() => () => {}),
      openDeviceStream: vi.fn(),
      closeDeviceStream: vi.fn(),
    },
  })
  return { deviceBind, deviceBoot, deviceDetach }
}

describe('iOS Simulator panel device switching', () => {
  beforeEach(() => {
    localStorage.clear()
    useDeviceInstanceStore.setState({ byId: {} })
  })

  async function pickFromMenu(user: ReturnType<typeof userEvent.setup>, trigger: RegExp, item: RegExp) {
    await user.click(await screen.findByRole('button', { name: trigger }))
    await user.click(await screen.findByRole('menuitem', { name: item }))
  }

  it('draws a simulator chosen from the menu without booting it', async () => {
    const user = userEvent.setup()
    const { deviceBoot, deviceBind } = stubEnvironment([RECENT, OTHER])

    render(<DevicePanel instanceId={openInstance()} />)
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

    render(<DevicePanel instanceId={openInstance()} />)
    await waitFor(() => expect(deviceBind).toHaveBeenCalledWith('session-1', booted.id))

    await pickFromMenu(user, /iPhone 17 Pro · iOS 26.0/, /iPhone Air · iOS 26.0/)

    // Otherwise the panel would draw one device while Disconnect and Shut Down still
    // pointed at the one it never released. Named by DEVICE: the session may be
    // holding another one in a second tab, and that one is not being let go of.
    await waitFor(() => expect(deviceDetach).toHaveBeenCalledWith(booted.id))
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })
})

describe('iOS Simulator panel reopening', () => {
  beforeEach(() => {
    localStorage.clear()
    useDeviceInstanceStore.setState({ byId: {} })
  })

  it('shows the last simulator this machine launched without booting it', async () => {
    localStorage.setItem('superone.device.recentIds', JSON.stringify([RECENT.id, OTHER.id]))
    const { deviceBind, deviceBoot } = stubEnvironment([RECENT, OTHER])

    render(<DevicePanel instanceId={openInstance()} />)

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

    render(<DevicePanel instanceId={openInstance()} />)

    await waitFor(() => expect(deviceBind).toHaveBeenCalledWith('session-1', booted.id))
    // Attaching is free; booting is not. Nothing was started.
    expect(deviceBoot).not.toHaveBeenCalled()
  })

  it('opens on the picker rather than a running simulator another session holds', async () => {
    const taken = { ...RECENT, running: true, boundSessionId: 'session-2' }
    localStorage.setItem('superone.device.recentIds', JSON.stringify([taken.id]))
    const { deviceBind } = stubEnvironment([taken, OTHER])

    render(<DevicePanel instanceId={openInstance()} />)

    // Not taken, and not even drawn. A fresh tab landing on a device it can only
    // offer a disabled Connect for is a dead end the user then has to back out of.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Choose a Device/ }).length).toBe(2))
    expect(deviceBind).not.toHaveBeenCalled()
  })

  it('opens the second tab on a different device from the first', async () => {
    const running = { ...RECENT, running: true }
    const alsoRunning = { ...OTHER, running: true }
    stubEnvironment([running, alsoRunning])

    render(<DevicePanel instanceId={openInstance()} />)
    await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })

    // The whole point of two tabs: a client build on one device and a merchant build
    // on the other. Both landing on the same phone would make them indistinguishable.
    render(<DevicePanel instanceId={openInstance()} />)
    expect(await screen.findByRole('button', { name: /iPhone Air · iOS 26.0/ })).toBeInTheDocument()
  })

  it('frames the environment probe in a device body rather than a bare spinner', async () => {
    let answer: (() => void) | undefined
    const held = new Promise<void>((resolve) => { answer = resolve })
    stubEnvironment([RECENT])
    const environment = window.environment as unknown as { iosSimulatorStatus: () => Promise<unknown> }
    environment.iosSimulatorStatus = async () => { await held; return { supported: true } }

    render(<DevicePanel instanceId={openInstance()} />)

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

    render(<DevicePanel instanceId={openInstance()} />)
    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()

    // Through the seam the dockview tab presses, since the tab lives outside this
    // panel. Re-reading the list is how a simulator Xcode just created shows up;
    // losing your place for it — back to "Choose a Simulator" — was the bug.
    await waitFor(() =>
      expect(useDeviceTabActions.getState().byInstance[instanceId]).toBeDefined())
    act(() => { useDeviceTabActions.getState().byInstance[instanceId]!.refresh() })

    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })

  it('tells the tab which device it is showing, so it can be named', async () => {
    localStorage.setItem('superone.device.recentIds', JSON.stringify([RECENT.id]))
    stubEnvironment([RECENT, OTHER])

    render(<DevicePanel instanceId={openInstance()} />)
    // Without this the tab says "Device", and a session holding two of them shows two
    // tabs the user has to click to tell apart.
    await waitFor(() =>
      expect(useDeviceTabActions.getState().byInstance[instanceId]?.device).toEqual({
        name: RECENT.name,
        provider: RECENT.provider,
        kind: RECENT.kind,
      }))
  })

  it('takes its refresh action off the tab when the panel goes away', async () => {
    stubEnvironment([RECENT])

    const view = render(<DevicePanel instanceId={openInstance()} />)
    await waitFor(() =>
      expect(useDeviceTabActions.getState().byInstance[instanceId]).toBeDefined())

    view.unmount()

    // Otherwise a closed panel leaves a live button on a tab that outlives it.
    expect(useDeviceTabActions.getState().byInstance[instanceId]).toBeUndefined()
  })

  it('falls back to the picker when nothing has been launched on this machine', async () => {
    stubEnvironment([RECENT, OTHER])

    render(<DevicePanel instanceId={openInstance()} />)

    // The header trigger and the one on the empty stage. `waitFor`, not `findAll`:
    // the header's is already there during the environment probe, so a first match
    // proves nothing about the stage having settled.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Choose a Device/ })).toHaveLength(2))
  })
})
