import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { DeviceDescriptor, DeviceSessionState } from '@superone/shared/device'
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

function state(device: DeviceDescriptor | null): DeviceSessionState {
  return {
    sessionId: 'session-1',
    device,
    phase: device ? 'ready' : 'idle',
    interactive: Boolean(device),
    orientation: 'portrait',
  }
}

function surface(provider: DeviceSurface['provider']): DeviceSurface {
  return {
    provider,
    devicesOf: vi.fn(() => [] as string[]),
    state: vi.fn(async () => state(null)),
    bind: vi.fn(async () => state(IOS_DEVICE)),
    boot: vi.fn(async () => state(IOS_DEVICE)),
    detach: vi.fn(async () => state(null)),
    shutdown: vi.fn(async () => state(null)),
    releaseSession: vi.fn(async () => {}),
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

  it('routes to the surface that holds the session\'s device', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    vi.mocked(android.devicesOf).mockReturnValue(['android:emulator-5554'])
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    await electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT)!(
      {},
      'session-1',
      { type: 'button', button: 'home' },
    )

    expect(android.input).toHaveBeenCalledWith('android:emulator-5554', { type: 'button', button: 'home' })
    expect(ios.input).not.toHaveBeenCalled()
  })

  /**
   * The regression this seam exists for. `state` on iOS spawns
   * `simctl list devices --json` — ~250ms — and a dragging finger routes an input
   * every 8ms, so a router that reads it makes the simulator unusable.
   */
  it('never reads device state to route, however many surfaces there are', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    vi.mocked(ios.devicesOf).mockReturnValue(['ios-sim:sim-1'])
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const handlers = electron.handlers
    await handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_INPUT)!({}, 'session-1', {
      type: 'button', button: 'home',
    })
    await handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_SCREENSHOT)!({}, 'session-1')

    expect(ios.state).not.toHaveBeenCalled()
    expect(android.state).not.toHaveBeenCalled()
  })

  it('answers for a session holding nothing without asking any surface', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    const answer = await electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STATE)!({}, 'session-1')

    // An empty stage with a picker, which is what an unbound panel shows. Asking a
    // surface would cost a `simctl list` to be told what the host already knows.
    expect(answer).toMatchObject({ sessionId: 'session-1', device: null, phase: 'idle' })
    expect(ios.state).not.toHaveBeenCalled()
    expect(android.state).not.toHaveBeenCalled()
  })

  it('releases every device a session held, on every surface', async () => {
    const ios = surface('ios-sim')
    const android = surface('android')
    registerDeviceIpc({ surfaces: () => [ios, android], listDevices: async () => [] })

    await electron.handlers.get(AgentIpcChannels.ENVIRONMENT_DEVICE_RELEASE)!({}, 'session-1')

    // Both, not just the owner: a session may hold an emulator and a simulator at once.
    expect(ios.releaseSession).toHaveBeenCalledWith('session-1')
    expect(android.releaseSession).toHaveBeenCalledWith('session-1')
  })

  it('unsubscribes a stream closed right behind its open', async () => {
    const ios = surface('ios-sim')
    vi.mocked(ios.devicesOf).mockReturnValue(['ios-sim:sim-1'])
    const unsubscribe = vi.fn()
    vi.mocked(ios.subscribe).mockReturnValue(unsubscribe)
    registerDeviceIpc({ surfaces: () => [ios], listDevices: async () => [] })

    const event = { sender: { id: 7, postMessage: vi.fn() }, ports: [] }
    electron.listeners.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_OPEN)!(event, 'session-1')
    electron.listeners.get(AgentIpcChannels.ENVIRONMENT_DEVICE_STREAM_CLOSE)!(event, 'session-1')

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
