import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor } from '@superone/shared/device'
import { buildDeviceCatalog } from './device-catalog'

function device(
  partial: Partial<DeviceDescriptor> & Pick<DeviceDescriptor, 'id' | 'name' | 'model'>,
): DeviceDescriptor {
  return {
    provider: 'ios-sim',
    platform: 'ios',
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    platformVersion: 'iOS 26.5',
    versionRank: 26005,
    running: false,
    available: true,
    ...partial,
  }
}

describe('device catalog', () => {
  const devices = [
    device({ id: 'ios:p17-265', name: 'iPhone 17 Pro', model: 'iPhone 17 Pro' }),
    device({
      id: 'ios:p17-260',
      name: 'iPhone 17 Pro',
      model: 'iPhone 17 Pro',
      platformVersion: 'iOS 26.0',
      versionRank: 26000,
    }),
    device({
      id: 'ios:ipad-265',
      name: 'iPad (A16)',
      model: 'iPad (A16)',
      kind: 'ipad',
      kindName: 'iPad',
      kindRank: 1,
    }),
    device({
      id: 'android:emulator-5554',
      provider: 'android',
      platform: 'android',
      name: 'Medium Phone API 36',
      model: 'Medium Phone API 36',
      kind: 'phone',
      kindName: 'Phone',
      kindRank: 0,
      platformVersion: 'Android 16',
      versionRank: 36,
      running: true,
    }),
  ]

  it('groups devices by platform family, model, and version', () => {
    const catalog = buildDeviceCatalog(devices)

    expect(catalog.map((family) => family.id))
      .toEqual(['ios:iphone', 'ios:ipad', 'android:phone'])
    expect(catalog[0]!.models[0]!.devices.map((entry) => entry.id))
      .toEqual(['ios:p17-265', 'ios:p17-260'])
  })

  it('keeps a one-device Android AVD as a shallow model row', () => {
    const android = buildDeviceCatalog(devices).find((family) => family.platform === 'android')!

    expect(android.models).toHaveLength(1)
    expect(android.models[0]!.devices.map((entry) => entry.id))
      .toEqual(['android:emulator-5554'])
  })

  it('drops unavailable devices and empty families', () => {
    const catalog = buildDeviceCatalog([
      ...devices,
      device({
        id: 'ios:tv-broken',
        name: 'Apple TV 4K',
        model: 'Apple TV 4K',
        kind: 'tv',
        kindName: 'Apple TV',
        kindRank: 3,
        available: false,
      }),
    ])

    expect(catalog.map((family) => family.id)).not.toContain('ios:tv')
  })
})
