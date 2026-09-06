import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { IosSimulatorDevice, IosSimulatorFrame } from '@superone/shared/ios-simulator'
import type { DevicePlatformPort } from '../device/platform-port'
import {
  IosSimulatorDevicePort,
  type IosSimulatorCatalogSource,
} from '../ios-simulator/device-port'
import { clearDeviceControlConfirmsForTests, resolveDeviceControlConfirm } from './control-confirm'
import { requestDeviceControl } from './control'
import type { DeviceGrantsPort, DeviceGrantSubject } from './device-grants'
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
  readonly ports: DevicePlatformPort[]
  private readonly previewListeners = new Set<(frame: IosSimulatorFrame) => void>()
  autoPreview = true

  constructor(private catalog: IosSimulatorDevice[]) {
    this.ports = [new IosSimulatorDevicePort(this)]
  }

  async listDevices(): Promise<IosSimulatorDevice[]> { return this.catalog }

  /**
   * Stamp ownership onto the listing, which is where the real manager puts it.
   *
   * Ownership used to be a second question the port answered separately; it is read
   * off the rows now, so a fake that only tracked it on the side would be testing a
   * mechanism that no longer exists.
   */
  grant(sessionId: string, udid: string): void {
    this.catalog = this.catalog.map((candidate) => candidate.udid === udid
      ? { ...candidate, state: 'Booted', booted: true, boundSessionId: sessionId }
      : candidate)
  }

  async boot(
    sessionId: string,
    udid: string,
  ): Promise<{ phase: string; device: IosSimulatorDevice | null }> {
    this.booted.push({ sessionId, udid })
    if (this.catalog.some((candidate) => candidate.udid === udid)) this.grant(sessionId, udid)
    const chosen = this.catalog.find((candidate) => candidate.udid === udid) ?? null
    return { phase: chosen ? 'ready' : 'idle', device: chosen }
  }

  /** Powering on without binding. Recorded separately so a test can tell them apart. */
  async power(udid: string): Promise<IosSimulatorDevice> {
    const chosen = this.catalog.find((candidate) => candidate.udid === udid)
    if (!chosen) throw new Error(`Simulator ${udid} was not found.`)
    return chosen
  }

  subscribe(_udid: string, listener: (frame: IosSimulatorFrame) => void): () => void {
    this.previewListeners.add(listener)
    if (this.autoPreview) queueMicrotask(() => this.emitPreviewFrame())
    return () => { this.previewListeners.delete(listener) }
  }

  emitPreviewFrame(keyframe = true): void {
    const frame: IosSimulatorFrame = {
      deviceId: 'cold', sequence: 1, timestampMs: 1,
      mimeType: 'video/avc', keyframe, codecConfig: false,
      data: new Uint8Array([1]),
    }
    for (const listener of this.previewListeners) listener(frame)
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

/** Standing grants, with the writes recorded so "always" can be told from "once". */
function fakeGrants(granted: string[] = []): DeviceGrantsPort & { granted: DeviceGrantSubject[] } {
  const written: DeviceGrantSubject[] = []
  return {
    granted: written,
    isGranted: (deviceId) => granted.includes(deviceId),
    grant: (device) => { written.push(device) },
  }
}

afterEach(() => {
  clearDeviceControlConfirmsForTests()
})

describe('requestDeviceControl', () => {
  it('does not confirm control until the live preview has produced a frame', async () => {
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    port.autoPreview = false
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))
    let settled = false

    const request = requestDeviceControl({
      sessionId: 's1', ports: port.ports, emitHostEvent: host.emit, request: { device: 'cold' },
    }).finally(() => { settled = true })

    await vi.waitFor(() => expect(port.booted).toEqual([{ sessionId: 's1', udid: 'cold' }]))
    await Promise.resolve()
    expect(settled).toBe(false)

    port.emitPreviewFrame(false)
    await Promise.resolve()
    expect(settled).toBe(false)

    port.emitPreviewFrame()
    await expect(request).resolves.toMatchObject({ controlled: true })
  })

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

  it('enumerates the machine once, not once to list and once to ask what is held', async () => {
    // `simctl list devices --json` is a quarter of a second against
    // CoreSimulatorService. Asking a port which device the session controls used to
    // be a second question that spawned a second one — ownership is stamped onto
    // every row as it is listed, so the answer was already in hand.
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    const listDevices = vi.spyOn(port, 'listDevices')
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1', ports: port.ports, emitHostEvent: host.emit, request: { device: 'cold' },
    })

    expect(listDevices).toHaveBeenCalledOnce()
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
    port.grant('s1', 'warm')
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
    port.grant('s1', 'warm')
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      request: { device: 'iPad Pro 13-inch' },
    })

    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'pad' }])
  })

  it('tells the agent not to open Apple\'s Simulator, and how to work without it', async () => {
    // This note is the ONLY thing standing between the agent and a duplicate window:
    // `open -a Simulator` un-hides the app the host hid, and an un-hide is
    // indistinguishable from the user reaching for it -- so the host cannot take that
    // one back. Enforcement was tried and deliberately dropped; see the note itself.
    const port = new FakePort([device({ udid: 'a', name: 'iPhone 16' })])
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    const result = await requestDeviceControl({
      sessionId: 's1', ports: port.ports, emitHostEvent: host.emit, request: { device: 'a' },
    })

    const note = String(result.note)
    expect(note).toMatch(/open -a Simulator/)
    expect(note).toMatch(/flutter emulators --launch/)
    // Expo has to be named: every one of its launchers opens Apple's Simulator before
    // it does anything else, so "build-and-run is fine" was quietly false for it.
    expect(note).toMatch(/expo run:ios/)
    // Naming it is only half the job -- an agent told to avoid the only launcher it
    // knows will either stall or ignore the note. The replacement is what makes the
    // instruction followable.
    expect(note).toMatch(/simctl openurl/)
    expect(note).toMatch(/simctl install/)
    // Building and running is the whole point of holding a device, and flutter's
    // runner never opens that window, so it must not be swept up in the prohibition.
    expect(note).toMatch(/flutter run -d [^`]*` needs no workaround/)
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
      resolveDeviceControlConfirm(requestId, 'decline', false, 'Use the iPad instead')
    })

    await expect(requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      request: { device: 'a' },
    })).rejects.toThrow(/Use the iPad instead/)
    expect(port.booted).toEqual([])
  })

  it('skips the prompt for a device the user already granted standing', async () => {
    const port = new FakePort([device({ udid: 'granted', name: 'iPhone 16' })])
    const grants = fakeGrants(['ios-sim:granted'])
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    const result = await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      grants,
      request: { device: 'granted' },
    })

    expect(host.requests).toEqual([])
    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'granted' }])
    expect(result).toMatchObject({ controlled: true })
  })

  it('records a standing grant only when the user chooses always', async () => {
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    const grants = fakeGrants()
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept', true))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      grants,
      request: { device: 'cold' },
    })

    expect(grants.granted).toEqual([
      { id: 'ios-sim:cold', name: 'iPhone 16', platformVersion: 'iOS 26.4' },
    ])
  })

  it('leaves a plain accept scoped to this chat, so the next session still asks', async () => {
    const port = new FakePort([device({ udid: 'cold', name: 'iPhone 16' })])
    const grants = fakeGrants()
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      grants,
      request: { device: 'cold' },
    })

    expect(grants.granted).toEqual([])
  })

  it('still asks for a device that was not granted', async () => {
    const port = new FakePort([
      device({ udid: 'granted', name: 'iPhone 16' }),
      device({ udid: 'other', name: 'iPad Pro' }),
    ])
    const grants = fakeGrants(['ios-sim:granted'])
    const host = autoAnswer((requestId) => resolveDeviceControlConfirm(requestId, 'accept'))

    await requestDeviceControl({
      sessionId: 's1',
      ports: port.ports,
      emitHostEvent: host.emit,
      grants,
      request: { device: 'other' },
    })

    expect(host.requests).toHaveLength(1)
  })
})
