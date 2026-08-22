import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { DeviceDescriptor, DeviceState } from '@superone/shared/device'
import type { DeviceSurface } from './surface'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  ports: [] as Array<{
    port1: { close: ReturnType<typeof vi.fn> }
    port2: {
      close: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
      start: ReturnType<typeof vi.fn>
      postMessage: ReturnType<typeof vi.fn>
    }
  }>,
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electron.handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (...args: any[]) => any) => {
      electron.listeners.set(channel, listener)
    }),
  },
  MessageChannelMain: class {
    port1 = { close: vi.fn() }
    port2 = {
      close: vi.fn(),
      on: vi.fn(),
      start: vi.fn(),
      postMessage: vi.fn(),
    }

    constructor() {
      electron.ports.push({ port1: this.port1, port2: this.port2 })
    }
  },
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

import { closeDevicePorts, registerDeviceIpc } from './ipc'

const IOS_DEVICE: DeviceDescriptor = {
  id: 'ios-sim:sim-1',
  provider: 'ios-sim',
  platform: 'ios',
  name: 'iPhone',
  kind: 'iphone',
  kindName: 'iPhone',
  kindRank: 0,
  model: 'iPhone',
  platformVersion: 'iOS 26',
  versionRank: 26,
  running: true,
  available: true,
}

function state(device: DeviceDescriptor | null): DeviceState {
  return {
    deviceId: device?.id ?? 'ios-sim:sim-1',
    owner: device ? 'session-1' : null,
    device,
    phase: device ? 'ready' : 'idle',
    interactive: Boolean(device),
    orientation: 'portrait',
  }
}

function surface(provider: DeviceSurface['provider']): DeviceSurface {
  return {
    provider,
    state: vi.fn(async () => state(null)),
    bind: vi.fn(async () => state(IOS_DEVICE)),
    boot: vi.fn(async () => state(IOS_DEVICE)),
    detach: vi.fn(async () => state(null)),
    shutdown: vi.fn(async () => state(null)),
    release: vi.fn(async () => {}),
    input: vi.fn(async () => ({ ok: true })),
    screenshot: vi.fn(async () => ({ kind: 'screenshot', path: '/shot.png', fileName: 'shot.png' })),
    startRecording: vi.fn(async () => ({ kind: 'recording', path: '/clip.mp4', fileName: 'clip.mp4' })),
    stopRecording: vi.fn(async () => null),
    isRecording: vi.fn(() => false),
    subscribe: vi.fn(() => () => {}),
    onState: vi.fn(() => () => {}),
  }
}

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  electron.ports.length = 0
})

afterEach(() => closeDevicePorts())

describe('device IPC routing', () => {
  it('routes a named device directly to the surface in its id', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const bind = electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_BIND)!
    await bind({}, 'session-1', 'android:emulator-5554')

    expect(android.bind).toHaveBeenCalledWith('session-1', 'android:emulator-5554')
    expect(ios.bind).not.toHaveBeenCalled()
  })

  /**
   * Two devices in one chat session, each driven from its own panel.
   *
   * The whole reason these channels name the device: asked which device "session-1"
   * means, the host has no answer — and the one it used to give (the first device the
   * session held) sent the merchant app's taps to the client app's phone.
   */
  it('sends each panel\'s input to the device that panel named', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const input = electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT)!
    await input({}, 'android:emulator-5554', { type: 'button', button: 'home' })
    await input({}, 'ios-sim:sim-1', { type: 'button', button: 'lock' })

    expect(android.input).toHaveBeenCalledWith('android:emulator-5554', { type: 'button', button: 'home' })
    expect(ios.input).toHaveBeenCalledWith('ios-sim:sim-1', { type: 'button', button: 'lock' })
    expect(android.input).toHaveBeenCalledOnce()
    expect(ios.input).toHaveBeenCalledOnce()
  })

  /**
   * The regression this seam exists for. `state` on iOS spawns
   * `simctl list devices --json` — ~250ms — and a dragging finger routes an input
   * every 8ms, so a router that reads it makes the simulator unusable.
   */
  it('never reads device state to route, however many surfaces there are', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const handlers = electron.handlers
    await handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT)!({}, 'ios-sim:sim-1', {
      type: 'button', button: 'home',
    })
    await handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_SCREENSHOT)!({}, 'ios-sim:sim-1')

    expect(ios.state).not.toHaveBeenCalled()
    expect(android.state).not.toHaveBeenCalled()
  })

  it('refuses a device whose provider no surface is registered for', () => {
    const ios = surface('ios-sim')
    registerDeviceIpc({ surfaces: () => [ios], listDevices: async () => [] })

    // Android with no SDK: the surface is never built, so the id routes nowhere.
    // Better a named error than a silent no-op the panel reads as "no frames yet".
    expect(() => electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT)!(
      {}, 'android:emulator-5554', { type: 'button', button: 'home' },
    )).toThrow('android:emulator-5554')
  })

  it('releases only the device whose tab was closed', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    await electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_RELEASE)!({}, 'android:emulator-5554')

    // Closing one of a session's two device tabs must not take the other one down,
    // which is exactly what releasing by session did.
    expect(android.release).toHaveBeenCalledWith('android:emulator-5554')
    expect(ios.release).not.toHaveBeenCalled()
  })

  it('unsubscribes a stream closed right behind its open', async () => {
    const ios = surface('ios-sim')
    const unsubscribe = vi.fn()
    vi.mocked(ios.subscribe).mockReturnValue(unsubscribe)
    registerDeviceIpc({ surfaces: () => [ios], listDevices: async () => [] })

    const event = { sender: { id: 7, postMessage: vi.fn() }, ports: [] }
    electron.listeners.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_OPEN)!(event, 'ios-sim:sim-1')
    electron.listeners.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_CLOSE)!(event, 'ios-sim:sim-1')

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  /**
   * One window, two devices, two streams. Keyed by session these collided: opening
   * the second closed the first, so the second panel to mount was the only one with
   * a picture.
   */
  it('keeps a stream per device in the same window', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    const unsubscribeIos = vi.fn()
    vi.mocked(ios.subscribe).mockReturnValue(unsubscribeIos)
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const event = { sender: { id: 7, postMessage: vi.fn() }, ports: [] }
    const open = electron.listeners.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_OPEN)!
    open(event, 'ios-sim:sim-1')
    open(event, 'android:emulator-5554')

    expect(unsubscribeIos).not.toHaveBeenCalled()
    expect(ios.subscribe).toHaveBeenCalledOnce()
    expect(android.subscribe).toHaveBeenCalledOnce()
  })
})
