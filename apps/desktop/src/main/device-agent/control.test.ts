import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import type { DevicePlatformPort } from '../device/platform-port'
import {
  IosSimulatorDevicePort,
  type IosSimulatorCatalogSource,
} from '../ios-simulator/device-port'
import { clearDeviceControlConfirmsForTests, resolveDeviceControlConfirm } from './control-confirm'
import { requestDeviceControl } from './control'
import type { DeviceRecentsPort } from './device-recents'
import { DeviceAgentError } from './types'

function device(overrides: Partial<IosSimulatorDevice> & { udid: string; name: string }): IosSimulatorDevice {
  return {
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
    runtimeName: 'iOS 26.4',
    state: overrides.booted ? 'Booted' : 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...overrides,
  }
}

/**
 * The manager, wrapped in the REAL iOS port.
 *
 * Faking the source rather than the neutral port means these also cover the
 * descriptor mapping and the `ios:` prefix — `booted` below records the BARE udid,
 * so it fails loudly if the prefix ever reaches the manager.
 */
class FakePort implements IosSimulatorCatalogSource {
  readonly booted: Array<{ sessionId: string; udid: string }> = []
  bound: IosSimulatorDevice | null = null
  readonly ports: DevicePlatformPort[]

  constructor(private readonly catalog: IosSimulatorDevice[]) {
    this.ports = [new IosSimulatorDevicePort(this)]
  }

  async listDevices(): Promise<IosSimulatorDevice[]> { return this.catalog }

  async getSessionState(): Promise<{ phase: string; device: IosSimulatorDevice | null }> {
    return { phase: this.bound ? 'ready' : 'idle', device: this.bound }
  }

  async boot(
    sessionId: string,
    udid: string,
  ): Promise<{ phase: string; device: IosSimulatorDevice | null }> {
    this.booted.push({ sessionId, udid })
    const chosen = this.catalog.find((candidate) => candidate.udid === udid) ?? null
    this.bound = chosen
    return { phase: chosen ? 'ready' : 'idle', device: chosen }
  }
}

/** Answer the prompt the moment it is emitted, the way the renderer would. */
function autoAnswer(
  answer: (requestId: string) => void,
): { emit: (event: AgentEvent) => void; requests: string[] } {
  const requests: string[] = []
  return {
    requests,
    emit: (event) => {
      if (event.type !== 'permission_request') return
      requests.push(event.request.requestId)
      queueMicrotask(() => answer(event.request.requestId))
    },
  }
}

afterEach(() => {
  clearDeviceControlConfirmsForTests()
})

describe('requestDeviceControl', () => {
  it('asks about the named device and boots exactly that one', async () => {
    const port = new FakePort([
      device({ udid: 'cold', name: 'iPhone 16' }),
      device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true }),
    ])
    let prompted: Record<string, unknown> | undefined
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    const result = await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: (event) => {
        if (event.type === 'permission_request') prompted = event.request.input as Record<string, unknown>
        host.emit(event)
      },
      request: { device: 'cold', reason: 'Drive the dev build' },
    })

    // The prompt is a plain yes/no on one device — no candidate list to pick from.
    expect(prompted?.device).toBe('iPhone 16')
    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'cold' }])
    expect(result.controlled).toBe(true)
  })

  it('resolves a device name loosely so a chat phrasing still lands', async () => {
    const port = new FakePort([
      device({ udid: 'a', name: 'iPhone 16' }),
      device({ udid: 'b', name: 'iPhone 17 Pro Max' }),
    ])
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      request: { device: '17 pro max' },
    })

    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'b' }])
  })

  it('tells the user which runtime, since the same model exists on every one', async () => {
    let prompted: Record<string, unknown> | undefined
    let message: string | undefined
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 17 Pro Max' })])

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: (event) => {
        if (event.type === 'permission_request') {
          prompted = event.request.input as Record<string, unknown>
          message = event.request.message
        }
        host.emit(event)
      },
      request: { device: 'cold' },
    })

    expect(prompted?.platform).toBe('iOS 26.4')
    expect(message).toContain('iOS 26.4')
  })

  it('says out loud that approving takes the device from another chat', async () => {
    let message: string | undefined
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))
    const port = new FakePort([
      device({ udid: 'held', name: 'iPhone 17 Pro Max', booted: true, boundSessionId: 's2' }),
    ])

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: (event) => {
        if (event.type === 'permission_request') message = event.request.message
        host.emit(event)
      },
      request: { device: 'held' },
    })

    expect(message).toMatch(/another chat session/)
  })

  it('reads the session state from the catalog it already listed', async () => {
    // `getSessionState` spawns `simctl list devices --json` when it is not handed a
    // catalog, and that is a quarter of a second against CoreSimulatorService.
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    const getSessionState = vi.spyOn(port, 'getSessionState')
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1', ports: port.ports, emitHostEvent: host.emit, request: { device: 'cold' },
    })

    // Handed the catalog, rather than left to read it again.
    expect(getSessionState).toHaveBeenCalledWith('s1', [expect.objectContaining({ udid: 'cold' })])
  })

  it('records a granted device for the project, and a declined one not at all', async () => {
    // What makes the next `device_list` able to lead with three devices instead of a
    // hundred. A device the user refused must never come back as a recommendation.
    const remembered: string[] = []
    const recents: DeviceRecentsPort = { read: () => remembered, remember: (udid) => { remembered.push(udid) } }
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    const accepting = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1', ports: port.ports, recents, emitHostEvent: accepting.emit, request: { device: 'cold' },
    })
    expect(remembered).toEqual(['ios-sim:cold'])

    // A separate machine state, so this is a first request rather than a re-grant.
    const refused = new FakePort([device({ udid: 'other', name: 'iPad Pro 13-inch' })])
    const declining = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'decline'))
    await expect(requestDeviceControl({
      sessionId: 's2', ports: refused.ports, recents, emitHostEvent: declining.emit, request: { device: 'other' },
    })).rejects.toThrow()
    expect(remembered).toEqual(['ios-sim:cold'])
  })

  it('returns the controlled device without prompting again', async () => {
    const bound = device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true })
    const port = new FakePort([bound])
    port.bound = bound
    const emit = vi.fn()

    const result = await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: emit,
      request: { device: 'warm' },
    })

    expect(emit).not.toHaveBeenCalled()
    expect(result.alreadyControlled).toBe(true)
    expect(port.booted).toEqual([])
  })

  it('prompts again when asked for a device other than the controlled one', async () => {
    const bound = device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true })
    const port = new FakePort([bound, device({ udid: 'pad', name: 'iPad Pro 13-inch' })])
    port.bound = bound
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      request: { device: 'iPad Pro 13-inch' },
    })

    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'pad' }])
  })

  it('tells the agent not to open Apple\'s Simulator, without banning real work', async () => {
    // This note is the ONLY thing standing between the agent and a duplicate window:
    // `flutter emulators --launch` ends with a plain `open -a Simulator`, which
    // un-hides the app the host hid, and an un-hide is indistinguishable from the user
    // reaching for it -- so the host cannot take that one back.
    const port = new FakePort([device({ udid: 'a', name: 'iPhone 16' })])
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    const result = await requestDeviceControl({
      sessionId: 's1', ports: port.ports, emitHostEvent: host.emit, request: { device: 'a' },
    })

    const note = String(result.note)
    expect(note).toMatch(/open -a Simulator/)
    expect(note).toMatch(/flutter emulators --launch/)
    // Building and running is the whole point of holding a device. Only the commands
    // whose sole effect is a window are off limits.
    expect(note).not.toMatch(/expo run:ios/)
    expect(note).toMatch(/simctl install/)
  })

  it('points an unmatched handle back at device_list instead of prompting', async () => {
    const port = new FakePort([device({ udid: 'a', name: 'iPhone 16' })])
    const emit = vi.fn()

    await expect(requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: emit,
      request: { device: 'Pixel 9' },
    })).rejects.toThrow(/device_list/)
    expect(emit).not.toHaveBeenCalled()
  })

  it('fails without prompting when nothing can be offered', async () => {
    const port = new FakePort([device({ udid: 'x', name: 'iPhone 16', available: false })])
    const emit = vi.fn()

    await expect(requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: emit,
      request: { device: 'x' },
    })).rejects.toBeInstanceOf(DeviceAgentError)
    expect(emit).not.toHaveBeenCalled()
  })

  it('carries the denial feedback back to the agent', async () => {
    // The whole reason this reuses the standard prompt: "no, use the iPad" is typed,
    // not clicked, and dropping it would leave the agent guessing at a refusal the
    // user already explained.
    const port = new FakePort([device({ udid: 'a', name: 'iPhone 16' })])
    const host = autoAnswer((requestId) => {
      resolveDeviceControlConfirm(requestId, 'decline', 'Use the iPad instead')
    })

    await expect(requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      request: { device: 'a' },
    })).rejects.toThrow(/Use the iPad instead/)
    expect(port.booted).toEqual([])
  })
})
