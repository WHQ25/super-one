/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceDescriptor } from '@superone/shared/device'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import { DeviceMenu } from './DeviceMenu'

// Captures `onCreated` so a scenario can fire the callback the real dialog would.
const createDialog = vi.hoisted(() => ({
  onCreated: null as ((device: IosSimulatorDevice) => void) | null,
}))
vi.mock('./ios/IosSimulatorCreateDialog', () => ({
  IosSimulatorCreateDialog: (
    { open, onCreated }: { open: boolean; onCreated: (device: IosSimulatorDevice) => void },
  ) => {
    createDialog.onCreated = onCreated
    return open ? <div data-testid="create-dialog" /> : null
  },
}))

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

// One model on two runtimes, one model on one, one booted iPad, one taken by a
// neighbouring session — every band the menu can draw, in one list.
const MAX_26 = device({ id: 'ios-sim:max-26', name: 'iPhone 17 Pro Max' })
const MAX_18 = device({
  id: 'ios-sim:max-18',
  name: 'iPhone 17 Pro Max',
  platformVersion: 'iOS 18.5',
  versionRank: 18005,
})
const SE = device({ id: 'ios-sim:se-26', name: 'iPhone SE (3rd generation)' })
const IPAD = device({
  id: 'ios-sim:ipad-26',
  name: 'iPad Pro 13-inch (M4)',
  kind: 'ipad',
  kindName: 'iPad',
  kindRank: 1,
  platformVersion: 'iPadOS 26.0',
  running: true,
})
const TAKEN = device({ id: 'ios-sim:taken-26', name: 'iPhone Air', boundSessionId: 'session-2' })

const DEVICES = [MAX_26, MAX_18, SE, IPAD, TAKEN]

function renderMenu(overrides: Partial<React.ComponentProps<typeof DeviceMenu>> = {}) {
  const onSelect = vi.fn()
  render(
    <DeviceMenu
      sessionId="session-1"
      devices={DEVICES}
      currentDeviceId="ios:max-26"
      setupOptions={[{ kind: 'ios-simulator', creatable: true }]}
      onSelect={onSelect}
      {...overrides}
    >
      <button type="button">Devices</button>
    </DeviceMenu>,
  )
  return { onSelect }
}

describe('iOS Simulator device menu', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('picks a runtime from the model submenu and remembers it as recent', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    // The two-runtime model nests; its runtimes are not on the first level.
    expect(screen.queryByRole('menuitem', { name: /iOS 18.5/ })).toBeNull()

    await user.click(await screen.findByRole('menuitem', { name: /iPhone 17 Pro Max/ }))
    // `fireEvent`, not `user.click`: Radix keeps a submenu open by testing whether the
    // pointer is inside a grace-area polygon built from `getBoundingClientRect`, which
    // jsdom reports as all zeroes. Any real pointer move onto the submenu therefore
    // reads as "left the trigger" and closes it before the click lands.
    fireEvent.click(await screen.findByRole('menuitem', { name: /iOS 18.5/ }))

    expect(onSelect).toHaveBeenCalledWith('ios-sim:max-18')
    expect(JSON.parse(localStorage.getItem('superone.device.recentIds') ?? '[]')).toEqual(['ios-sim:max-18'])
  })

  it('flattens a model that exists on exactly one runtime', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    await user.click(await screen.findByRole('menuitem', { name: /iPhone SE \(3rd generation\) · iOS 26.0/ }))

    expect(onSelect).toHaveBeenCalledWith('ios-sim:se-26')
  })

  it('lists a booted simulator under Running Now and keeps it out of Recent', async () => {
    localStorage.setItem('superone.device.recentIds', JSON.stringify(['ios-sim:ipad-26', 'ios-sim:se-26']))
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    const groups = screen.getAllByRole('group')
    // Running first, then Recent, then one group per family — the order a returning
    // user reads: what is up now, what I used last, everything else.
    expect(groups[0]).toHaveTextContent('Running Now')
    expect(groups[0]).toHaveTextContent('iPad Pro 13-inch (M4) · iPadOS 26.0')
    expect(groups[1]).toHaveTextContent('Recent')
    expect(groups[1]).toHaveTextContent('iPhone SE (3rd generation) · iOS 26.0')
    expect(groups[1]).not.toHaveTextContent('iPad Pro')
    expect(groups[2]).toHaveTextContent('iPhone')
  })

  it('hands a freshly created simulator to the panel in a single pass', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderMenu()
    const fresh: IosSimulatorDevice = {
      udid: 'new-26',
      name: 'iPhone 17',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
      runtimeName: 'iOS 26.0',
      state: 'Shutdown',
      booted: false,
      available: true,
      ownedBySuperOne: false,
    }

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    // Through the submenu, which is where creating one now lives: the bottom of the
    // menu offers every way a device can arrive, and only this one finishes here.
    await user.click(await screen.findByRole('menuitem', { name: /Add Device/ }))
    await user.click(await screen.findByRole('menuitem', { name: /iOS Simulator/ }))
    createDialog.onCreated!(fresh)

    // One pass, deliberately. `onSelect` re-reads the device list on its own, so the
    // refresh that used to run beside it was a second concurrent reader — both wrote
    // the selection and the list, and whichever landed last decided what was drawn.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('ios-sim:new-26')
    expect(JSON.parse(localStorage.getItem('superone.device.recentIds') ?? '[]'))
      .toEqual(['ios-sim:new-26'])
  })

  it('disables a simulator another session already holds', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    const taken = await screen.findByRole('menuitem', { name: /iPhone Air/ })
    expect(taken).toHaveAttribute('data-disabled')

    await user.click(taken)
    expect(onSelect).not.toHaveBeenCalled()
  })

  /**
   * The second reason a device can be spoken for, and the one main cannot report.
   *
   * A device the other tab is merely POINTED at — chosen but not yet booted — has no
   * owner, so `boundSessionId` is empty and nothing here would grey it out. Two tabs
   * of the same session drawing the same shut-down simulator is a pair the user has
   * no way to tell apart, which defeats the point of opening a second one.
   */
  it('disables a simulator another tab of this session is already on', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderMenu({ unavailableDeviceIds: [SE.id] })

    await user.click(screen.getByRole('button', { name: 'Devices' }))
    const held = await screen.findByRole('menuitem', { name: /iPhone SE \(3rd generation\)/ })
    expect(held).toHaveAttribute('data-disabled')

    await user.click(held)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
