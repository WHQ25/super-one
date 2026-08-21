/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IosSimulatorDevice, IosSimulatorSessionState } from '@superone/shared/ios-simulator'

vi.mock('./ios-simulator-video', () => ({
  preferredIosSimulatorPreviewMode: () => 'native-h264',
  IosSimulatorFrameRenderer: class {
    push() {}
    close() {}
  },
}))

import { IosSimulatorPanel } from './IosSimulatorPanel'
import { useIosSimulatorTabActions } from './ios-simulator-tab-actions'

function device(overrides: Partial<IosSimulatorDevice> & Pick<IosSimulatorDevice, 'udid' | 'name'>): IosSimulatorDevice {
  return {
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
    runtimeName: 'iOS 26.0',
    state: 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...overrides,
  }
}

const RECENT = device({ udid: 'p17-26', name: 'iPhone 17 Pro' })
const OTHER = device({ udid: 'air-26', name: 'iPhone Air' })

function ready(target: IosSimulatorDevice): IosSimulatorSessionState {
  return {
    sessionId: 'session-1',
    device: target,
    phase: 'ready',
    previewMode: 'native-h264',
    interactive: true,
    orientation: 'portrait',
    hardwareKeyboardConnected: true,
    hardwareKeyboardAvailable: true,
  }
}

function stubEnvironment(devices: IosSimulatorDevice[]) {
  const iosSimulatorBind = vi.fn(async (_sessionId: string, udid: string) =>
    ready(devices.find((entry) => entry.udid === udid)!))
  const iosSimulatorBoot = vi.fn(async (_sessionId: string, udid: string) =>
    ready(devices.find((entry) => entry.udid === udid)!))
  const iosSimulatorDetach = vi.fn(async () => null)
  // The setup file installs a get-trap Proxy that ignores its target, so stubs have
  // to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorStatus: vi.fn(async () => ({ supported: true })),
      iosSimulatorList: vi.fn(async () => devices),
      iosSimulatorBind,
      iosSimulatorBoot,
      iosSimulatorDetach,
      iosSimulatorChrome: vi.fn(async () => null),
      iosSimulatorInput: vi.fn(async () => ({ ok: true })),
      onIosSimulatorFrame: vi.fn(() => () => {}),
      onIosSimulatorRotateGesture: vi.fn(() => () => {}),
      onIosSimulatorSessionState: vi.fn(() => () => {}),
      openIosSimulatorStream: vi.fn(),
      closeIosSimulatorStream: vi.fn(),
    },
  })
  return { iosSimulatorBind, iosSimulatorBoot, iosSimulatorDetach }
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
    const { iosSimulatorBoot, iosSimulatorBind } = stubEnvironment([RECENT, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)
    await pickFromMenu(user, /Choose a Simulator/, /iPhone Air · iOS 26.0/)

    // The body and its Launch button, and nothing started behind them: choosing is
    // aiming the panel, not pulling the trigger.
    expect(await screen.findByRole('button', { name: /iPhone Air · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
    expect(iosSimulatorBoot).not.toHaveBeenCalled()
    expect(iosSimulatorBind).not.toHaveBeenCalled()
  })

  it('lets go of the simulator it holds before pointing at another', async () => {
    const booted = { ...RECENT, booted: true, state: 'Booted' }
    localStorage.setItem('superone.iosSimulator.recentUdids', JSON.stringify([booted.udid]))
    const user = userEvent.setup()
    const { iosSimulatorBind, iosSimulatorDetach } = stubEnvironment([booted, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)
    await waitFor(() => expect(iosSimulatorBind).toHaveBeenCalledWith('session-1', booted.udid))

    await pickFromMenu(user, /iPhone 17 Pro · iOS 26.0/, /iPhone Air · iOS 26.0/)

    // Otherwise the panel would draw one device while Disconnect and Shut Down still
    // pointed at the one it never released.
    await waitFor(() => expect(iosSimulatorDetach).toHaveBeenCalledWith('session-1'))
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })
})

describe('iOS Simulator panel reopening', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the last simulator this machine launched without booting it', async () => {
    localStorage.setItem('superone.iosSimulator.recentUdids', JSON.stringify([RECENT.udid, OTHER.udid]))
    const { iosSimulatorBind, iosSimulatorBoot } = stubEnvironment([RECENT, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)

    // Named in the header and drawn on the stage, but still shut down: opening the
    // panel is not the same as claiming a simulator.
    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
    expect(iosSimulatorBoot).not.toHaveBeenCalled()
    expect(iosSimulatorBind).not.toHaveBeenCalled()
  })

  it('steps straight back into that simulator when it is already running and unclaimed', async () => {
    const booted = { ...RECENT, booted: true, state: 'Booted' }
    localStorage.setItem('superone.iosSimulator.recentUdids', JSON.stringify([booted.udid]))
    const { iosSimulatorBind, iosSimulatorBoot } = stubEnvironment([booted, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)

    await waitFor(() => expect(iosSimulatorBind).toHaveBeenCalledWith('session-1', booted.udid))
    // Attaching is free; booting is not. Nothing was started.
    expect(iosSimulatorBoot).not.toHaveBeenCalled()
  })

  it('leaves a running simulator alone when another session already holds it', async () => {
    const taken = { ...RECENT, booted: true, state: 'Booted', boundSessionId: 'session-2' }
    localStorage.setItem('superone.iosSimulator.recentUdids', JSON.stringify([taken.udid]))
    const { iosSimulatorBind } = stubEnvironment([taken, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled()
    expect(iosSimulatorBind).not.toHaveBeenCalled()
  })

  it('frames the environment probe in a device body rather than a bare spinner', async () => {
    let answer: (() => void) | undefined
    const held = new Promise<void>((resolve) => { answer = resolve })
    stubEnvironment([RECENT])
    const environment = window.environment as unknown as { iosSimulatorStatus: () => Promise<unknown> }
    environment.iosSimulatorStatus = async () => { await held; return { supported: true } }

    render(<IosSimulatorPanel sessionId="session-1" />)

    // The drawn shell paints its glass black and its side keys #4a4a54 — a body is
    // on screen before simctl has said a word.
    expect(await screen.findByText('Checking the local iOS Simulator environment…')).toBeInTheDocument()
    expect(document.querySelector('.bg-black')).not.toBeNull()

    answer?.()
    await waitFor(() => expect(screen.queryByText('Checking the local iOS Simulator environment…')).toBeNull())
  })

  it('keeps the device on screen across a manual refresh', async () => {
    localStorage.setItem('superone.iosSimulator.recentUdids', JSON.stringify([RECENT.udid]))
    stubEnvironment([RECENT, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)
    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()

    // Through the seam the dockview tab presses, since the tab lives outside this
    // panel. Re-reading the list is how a simulator Xcode just created shows up;
    // losing your place for it — back to "Choose a Simulator" — was the bug.
    await waitFor(() =>
      expect(useIosSimulatorTabActions.getState().bySession['session-1']).toBeDefined())
    act(() => { useIosSimulatorTabActions.getState().bySession['session-1']!.refresh() })

    expect(await screen.findByRole('button', { name: /iPhone 17 Pro · iOS 26.0/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled()
  })

  it('takes its refresh action off the tab when the panel goes away', async () => {
    stubEnvironment([RECENT])

    const view = render(<IosSimulatorPanel sessionId="session-1" />)
    await waitFor(() =>
      expect(useIosSimulatorTabActions.getState().bySession['session-1']).toBeDefined())

    view.unmount()

    // Otherwise a closed panel leaves a live button on a tab that outlives it.
    expect(useIosSimulatorTabActions.getState().bySession['session-1']).toBeUndefined()
  })

  it('falls back to the picker when nothing has been launched on this machine', async () => {
    stubEnvironment([RECENT, OTHER])

    render(<IosSimulatorPanel sessionId="session-1" />)

    // The header trigger and the one on the empty stage. `waitFor`, not `findAll`:
    // the header's is already there during the environment probe, so a first match
    // proves nothing about the stage having settled.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Choose a Simulator/ })).toHaveLength(2))
  })
})
