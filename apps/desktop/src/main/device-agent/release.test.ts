import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor, DeviceProvider } from '@superone/shared/device'
import type { DevicePlatformPort, DeviceReleaseOutcome } from '../device/platform-port'
import { releaseDevice } from './release'

/**
 * A port that records how it was asked to let go. Its own put-back rule is the
 * simplest one that still distinguishes the cases: it stops what it is told it
 * started, and only that, unless forced.
 */
class ReleasablePort implements DevicePlatformPort {
  readonly platform = 'ios' as const
  readonly released: Array<{ deviceId: string; shutdown: boolean }> = []
  startedByUs = new Set<string>()
  canStop = true

  constructor(readonly provider: DeviceProvider) {}

  async listDevices(): Promise<DeviceDescriptor[]> { return [] }
  async boot(): Promise<DeviceDescriptor | null> { return null }
  async waitForPreview(): Promise<void> {}
  controlNote(): string { return 'note' }
  emptyNote(): string { return 'nothing here' }

  async release(deviceId: string, options: { shutdown: boolean }): Promise<DeviceReleaseOutcome> {
    this.released.push({ deviceId, shutdown: options.shutdown })
    const stop = this.canStop && (options.shutdown || this.startedByUs.has(deviceId))
    return stop ? 'shutdown' : 'detached'
  }
}

describe('releaseDevice', () => {
  it('stops a simulator this app booted and says so', async () => {
    const port = new ReleasablePort('ios-sim')
    port.startedByUs.add('ios-sim:A')

    const result = await releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A', name: 'iPhone 17' }],
      request: {},
    })

    expect(port.released).toEqual([{ deviceId: 'ios-sim:A', shutdown: false }])
    expect(result).toMatchObject({
      released: true,
      outcome: 'shutdown',
      running: false,
      device: { id: 'ios-sim:A', name: 'iPhone 17' },
    })
  })

  it('leaves a device the user had running up, and only unbinds it', async () => {
    const port = new ReleasablePort('ios-sim')

    const result = await releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A', name: 'iPhone 17' }],
      request: {},
    })

    expect(result).toMatchObject({ outcome: 'detached', running: true })
    expect(String(result.note)).toMatch(/still running/)
  })

  it('forces the stop with shutdown: true', async () => {
    const port = new ReleasablePort('ios-sim')

    const result = await releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A' }],
      request: { shutdown: true },
    })

    expect(port.released).toEqual([{ deviceId: 'ios-sim:A', shutdown: true }])
    expect(result).toMatchObject({ outcome: 'shutdown' })
  })

  it('reports a real phone as detached even when a shutdown was asked for', async () => {
    const port = new ReleasablePort('ios-mirror')
    port.canStop = false

    const result = await releaseDevice({
      ports: [port],
      held: [{ id: 'ios-mirror:iphone', name: 'iPhone' }],
      request: { shutdown: true },
    })

    expect(result).toMatchObject({ outcome: 'detached', running: true })
    // The agent asked for something that did not happen; the note has to own that
    // rather than let `released: true` read as "it is off now".
    expect(String(result.note)).toMatch(/cannot be turned off/)
  })

  it('routes to the port by provider, not platform', async () => {
    // Both are `ios`. The mirrored phone must not be handed to simctl.
    const sim = new ReleasablePort('ios-sim')
    const mirror = new ReleasablePort('ios-mirror')

    await releaseDevice({
      ports: [sim, mirror],
      held: [{ id: 'ios-mirror:iphone', name: 'iPhone' }],
      request: {},
    })

    expect(sim.released).toEqual([])
    expect(mirror.released).toHaveLength(1)
  })

  it('refuses when the session holds nothing, pointing at the grant tool', async () => {
    await expect(releaseDevice({ ports: [new ReleasablePort('ios-sim')], held: [], request: {} }))
      .rejects.toThrow(/device_request_control/)
  })

  it('refuses to guess when the session holds several and none is named', async () => {
    const port = new ReleasablePort('ios-sim')

    await expect(releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A', name: 'iPhone 17' }, { id: 'ios-sim:B', name: 'iPad' }],
      request: {},
    })).rejects.toThrow(/must name one/)
    expect(port.released).toEqual([])
  })

  it('releases the named one of several', async () => {
    const port = new ReleasablePort('ios-sim')

    const result = await releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A', name: 'iPhone 17' }, { id: 'ios-sim:B', name: 'iPad' }],
      request: { device: 'iPad' },
    })

    expect(port.released).toEqual([{ deviceId: 'ios-sim:B', shutdown: false }])
    expect(result).toMatchObject({ device: { id: 'ios-sim:B', name: 'iPad' } })
  })

  it('does not touch the device when already cancelled', async () => {
    const port = new ReleasablePort('ios-sim')
    const controller = new AbortController()
    controller.abort()

    await expect(releaseDevice({
      ports: [port],
      held: [{ id: 'ios-sim:A' }],
      request: {},
      signal: controller.signal,
    })).rejects.toThrow()
    expect(port.released).toEqual([])
  })
})
