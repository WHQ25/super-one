import { describe, expect, it } from 'vitest'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import { buildIosSimulatorCatalog, classifyIosSimulatorFamily } from './ios-simulator-catalog'

function device(partial: Partial<IosSimulatorDevice> & Pick<IosSimulatorDevice, 'udid' | 'name'>): IosSimulatorDevice {
  const runtimeName = partial.runtimeName ?? 'iOS 26.5'
  return {
    runtimeIdentifier: `com.apple.CoreSimulator.SimRuntime.${runtimeName.replace(/[ .]/g, '-')}`,
    runtimeName,
    state: 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...partial,
  }
}

describe('classifyIosSimulatorFamily', () => {
  it('reads the family off the product name so one iOS runtime can hold both phones and tablets', () => {
    expect(classifyIosSimulatorFamily(device({ udid: '1', name: 'iPhone 17 Pro' }))).toBe('iphone')
    expect(classifyIosSimulatorFamily(device({ udid: '2', name: 'iPad Pro 13-inch (M5)' }))).toBe('ipad')
    expect(classifyIosSimulatorFamily(device({ udid: '3', name: 'Apple Watch Series 10 (46mm)' }))).toBe('watch')
    expect(classifyIosSimulatorFamily(device({ udid: '4', name: 'Apple TV 4K (3rd generation)' }))).toBe('tv')
    expect(classifyIosSimulatorFamily(device({ udid: '5', name: 'Apple Vision Pro' }))).toBe('vision')
  })

  it('falls back to the runtime platform when the product name is unrecognised', () => {
    const renamed = device({ udid: '6', name: 'My Watch', runtimeName: 'watchOS 11.0' })
    expect(classifyIosSimulatorFamily(renamed)).toBe('watch')
    expect(classifyIosSimulatorFamily(device({ udid: '7', name: 'Whatever', runtimeName: 'Unknown 1.0' }))).toBe('other')
  })
})

describe('buildIosSimulatorCatalog', () => {
  const devices = [
    device({ udid: 'p17-265', name: 'iPhone 17 Pro', runtimeName: 'iOS 26.5' }),
    device({ udid: 'p17-260', name: 'iPhone 17 Pro', runtimeName: 'iOS 26.0' }),
    device({ udid: 'p15-175', name: 'iPhone 15 Pro', runtimeName: 'iOS 17.5' }),
    device({ udid: 'air-265', name: 'iPhone Air', runtimeName: 'iOS 26.5' }),
    device({ udid: 'ipad-265', name: 'iPad (A16)', runtimeName: 'iOS 26.5' }),
    device({ udid: 'watch-110', name: 'Apple Watch Series 10 (46mm)', runtimeName: 'watchOS 11.0' }),
  ]

  it('groups devices into families, models, and runtimes', () => {
    const catalog = buildIosSimulatorCatalog(devices)

    expect(catalog.map((family) => family.id)).toEqual(['iphone', 'ipad', 'watch'])
    const iphone = catalog[0]!
    expect(iphone.models.find((model) => model.name === 'iPhone 17 Pro')?.devices.map((d) => d.udid))
      .toEqual(['p17-265', 'p17-260'])
  })

  it('orders models by their newest runtime so current hardware leads the list', () => {
    const catalog = buildIosSimulatorCatalog(devices)

    expect(catalog[0]!.models.map((model) => model.name))
      .toEqual(['iPhone 17 Pro', 'iPhone Air', 'iPhone 15 Pro'])
  })

  it('drops unavailable devices and the families that only held them', () => {
    const catalog = buildIosSimulatorCatalog([
      ...devices,
      device({ udid: 'tv-broken', name: 'Apple TV 4K (3rd generation)', available: false, availabilityError: 'runtime profile not found' }),
    ])

    expect(catalog.map((family) => family.id)).not.toContain('tv')
  })

  it('keeps a family that still has one bootable model after an unavailable sibling is dropped', () => {
    const catalog = buildIosSimulatorCatalog([
      device({ udid: 'ok', name: 'iPhone 17', runtimeName: 'iOS 26.5' }),
      device({ udid: 'broken', name: 'iPhone 16e', runtimeName: 'iOS 26.5', available: false }),
    ])

    expect(catalog[0]!.models.map((model) => model.name)).toEqual(['iPhone 17'])
  })
})
