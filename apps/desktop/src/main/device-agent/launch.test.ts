import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { IosSimulatorDevice, IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { clearDeviceLaunchConfirmsForTests, resolveDeviceLaunchConfirm } from './launch-confirm'
import { requestDeviceLaunch, type DeviceLaunchPort } from './launch'
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

function readyState(sessionId: string, bound: IosSimulatorDevice | null): IosSimulatorSessionState {
  return {
    sessionId,
    device: bound,
    phase: bound ? 'ready' : 'idle',
    previewMode: 'h264',
    interactive: true,
    orientation: 'portrait',
    hardwareKeyboardConnected: true,
  } as IosSimulatorSessionState
}

class FakePort implements DeviceLaunchPort {
  readonly booted: Array<{ sessionId: string; udid: string }> = []
  bound: IosSimulatorDevice | null = null

  constructor(private readonly catalog: IosSimulatorDevice[]) {}

  async listDevices(): Promise<IosSimulatorDevice[]> { return this.catalog }
  async getSessionState(sessionId: string): Promise<IosSimulatorSessionState> {
    return readyState(sessionId, this.bound)
  }

  async boot(sessionId: string, udid: string): Promise<IosSimulatorSessionState> {
    this.booted.push({ sessionId, udid })
    const chosen = this.catalog.find((candidate) => candidate.udid === udid) ?? null
    this.bound = chosen
    return readyState(sessionId, chosen)
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
  clearDeviceLaunchConfirmsForTests()
})

describe('requestDeviceLaunch', () => {
  it('offers running devices first and boots the one the user approved', async () => {
    const port = new FakePort([
      device({ udid: 'cold', name: 'iPhone 16' }),
      device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true }),
    ])
    let payloadCandidates: string[] = []
    const host = autoAnswer((requestId) => {
      resolveDeviceLaunchConfirm(requestId, 'accept', { deviceId: 'cold' })
    })
    const emit = (event: AgentEvent) => {
      if (event.type === 'permission_request') {
        payloadCandidates = (event.request.deviceLaunchConfirm?.candidates ?? []).map((c) => c.id)
      }
      host.emit(event)
    }

    const result = await requestDeviceLaunch({
      sessionId: 's1',
      port,
      emitHostEvent: emit,
      request: { reason: 'Drive the dev build' },
    })

    expect(payloadCandidates).toEqual(['warm', 'cold'])
    // The user overrode the suggestion; the boot has to follow the answer, not the ask.
    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'cold' }])
    expect(result.connected).toBe(true)
  })

  it('preselects the device the agent named', async () => {
    const port = new FakePort([
      device({ udid: 'a', name: 'iPhone 16' }),
      device({ udid: 'b', name: 'iPhone 17 Pro Max' }),
    ])
    let suggested: string | undefined
    const host = autoAnswer((requestId) => resolveDeviceLaunchConfirm(requestId, 'accept'))

    await requestDeviceLaunch({
      sessionId: 's1',
      port,
      emitHostEvent: (event) => {
        if (event.type === 'permission_request') suggested = event.request.deviceLaunchConfirm?.suggestedId
        host.emit(event)
      },
      request: { device: '17 pro max' },
    })

    expect(suggested).toBe('b')
    // A plain allow with no formAnswers still has to approve something — the suggestion.
    expect(port.booted).toEqual([{ sessionId: 's1', udid: 'b' }])
  })

  it('returns the bound device without prompting again', async () => {
    const bound = device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true })
    const port = new FakePort([bound])
    port.bound = bound
    const emit = vi.fn()

    const result = await requestDeviceLaunch({
      sessionId: 's1',
      port,
      emitHostEvent: emit,
      request: {},
    })

    expect(emit).not.toHaveBeenCalled()
    expect(result.alreadyConnected).toBe(true)
    expect(port.booted).toEqual([])
  })

  it('prompts again when the agent asks for a different device than the bound one', async () => {
    const bound = device({ udid: 'warm', name: 'iPhone 17 Pro Max', booted: true })
    const port = new FakePort([bound, device({ udid: 'pad', name: 'iPad Pro 13-inch' })])
    port.bound = bound
    const host = autoAnswer((requestId) => resolveDeviceLaunchConfirm(requestId, 'accept'))

    await requestDeviceLaunch({
      sessionId: 's1',
      port,
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
    const host = autoAnswer((requestId) => resolveDeviceLaunchConfirm(requestId, 'accept'))

    const result = await requestDeviceLaunch({
      sessionId: 's1', port, emitHostEvent: host.emit, request: {},
    })

    const note = String(result.note)
    expect(note).toMatch(/open -a Simulator/)
    expect(note).toMatch(/flutter emulators --launch/)
    // Building and running is the whole point of holding a device. Only the commands
    // whose sole effect is a window are off limits.
    expect(note).not.toMatch(/expo run:ios/)
    expect(note).toMatch(/simctl install/)
  })

  it('fails without prompting when nothing can be offered', async () => {
    const port = new FakePort([device({ udid: 'x', name: 'iPhone 16', available: false })])
    const emit = vi.fn()

    await expect(requestDeviceLaunch({
      sessionId: 's1',
      port,
      emitHostEvent: emit,
      request: {},
    })).rejects.toBeInstanceOf(DeviceAgentError)
    expect(emit).not.toHaveBeenCalled()
  })

  it('surfaces a decline as an error the agent can read', async () => {
    const port = new FakePort([device({ udid: 'a', name: 'iPhone 16' })])
    const host = autoAnswer((requestId) => resolveDeviceLaunchConfirm(requestId, 'decline'))

    await expect(requestDeviceLaunch({
      sessionId: 's1',
      port,
      emitHostEvent: host.emit,
      request: {},
    })).rejects.toThrow(/declined/i)
    expect(port.booted).toEqual([])
  })
})
