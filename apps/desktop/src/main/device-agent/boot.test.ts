import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor } from '@superone/shared/device'
import type { DevicePlatformPort } from '../device/platform-port'
import { bootDevice } from './boot'

function descriptor(overrides: Partial<DeviceDescriptor> & { id: string; name: string }): DeviceDescriptor {
  return {
    provider: 'ios-sim',
    platform: 'ios',
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    model: 'iPhone 16',
    platformVersion: 'iOS 26.4',
    versionRank: 26_04,
    running: false,
    available: true,
    ...overrides,
  }
}

/**
 * A platform that can start its devices. Records every power-on so a test can assert
 * the difference that matters here: what was started, and what was NOT bound.
 */
class BootablePort implements DevicePlatformPort {
  readonly platform = 'ios' as const
  readonly powered: string[] = []
  readonly bound: string[] = []
  powerFails = false

  constructor(private catalog: DeviceDescriptor[]) {}

  async listDevices(): Promise<DeviceDescriptor[]> { return this.catalog }

  async boot(sessionId: string, deviceId: string): Promise<DeviceDescriptor | null> {
    this.bound.push(`${sessionId}:${deviceId}`)
    return this.catalog.find((entry) => entry.id === deviceId) ?? null
  }

  async power(deviceId: string): Promise<DeviceDescriptor | null> {
    this.powered.push(deviceId)
    if (this.powerFails) return null
    this.catalog = this.catalog.map((entry) => entry.id === deviceId
      ? { ...entry, running: true }
      : entry)
    return this.catalog.find((entry) => entry.id === deviceId) ?? null
  }

  async waitForPreview(): Promise<void> {}
  controlNote(): string { return 'note' }
  emptyNote(): string { return 'nothing here' }
}

/** A real phone: it is listed and grantable, but nothing here can turn it on. */
class MirrorLikePort implements DevicePlatformPort {
  readonly platform = 'ios' as const

  constructor(private readonly catalog: DeviceDescriptor[]) {}

  async listDevices(): Promise<DeviceDescriptor[]> { return this.catalog }
  async boot(): Promise<DeviceDescriptor | null> { return this.catalog[0] ?? null }
  async waitForPreview(): Promise<void> {}
  controlNote(): string { return 'note' }
  emptyNote(): string { return 'no phone' }
}

describe('bootDevice', () => {
  it('starts the device without binding it to the session', async () => {
    const port = new BootablePort([descriptor({ id: 'ios:cold', name: 'iPhone 16' })])

    const result = await bootDevice({ ports: [port], request: { device: 'ios:cold' } })

    expect(port.powered).toEqual(['ios:cold'])
    // The whole point of the split: no ownership was taken, so the control prompt
    // still has something to ask about.
    expect(port.bound).toEqual([])
    expect(result).toMatchObject({ running: true, alreadyRunning: false, controlled: false })
  })

  it('tells the agent it still needs device_request_control before driving', async () => {
    const port = new BootablePort([descriptor({ id: 'ios:cold', name: 'iPhone 16' })])

    const result = await bootDevice({ ports: [port], request: { device: 'ios:cold' } })

    expect(String(result.note)).toContain('device_request_control')
  })

  it('returns immediately for a device that is already up', async () => {
    const port = new BootablePort([
      descriptor({ id: 'ios:warm', name: 'iPhone 16', running: true }),
    ])

    const result = await bootDevice({ ports: [port], request: { device: 'ios:warm' } })

    expect(port.powered).toEqual([])
    expect(result).toMatchObject({ running: true, alreadyRunning: true })
  })

  it('refuses a platform that cannot start its devices, naming the next step', async () => {
    const port = new MirrorLikePort([descriptor({ id: 'ios-mirror:phone', name: 'iPhone' })])

    await expect(bootDevice({ ports: [port], request: { device: 'ios-mirror:phone' } }))
      .rejects.toThrow(/device_request_control/)
  })

  it('reports a device that never came up rather than claiming it did', async () => {
    const port = new BootablePort([descriptor({ id: 'ios:cold', name: 'iPhone 16' })])
    port.powerFails = true

    await expect(bootDevice({ ports: [port], request: { device: 'ios:cold' } }))
      .rejects.toThrow(/did not come up/)
  })

  it('rejects a handle that matches nothing, pointing back at device_list', async () => {
    const port = new BootablePort([descriptor({ id: 'ios:cold', name: 'iPhone 16' })])

    await expect(bootDevice({ ports: [port], request: { device: 'Pixel 9' } }))
      .rejects.toThrow(/device_list/)
  })
})
