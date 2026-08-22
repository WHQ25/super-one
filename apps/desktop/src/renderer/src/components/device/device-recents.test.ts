import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor } from '@superone/shared/device'
import {
  DEVICE_RECENT_LIMIT,
  readRecentDeviceIds,
  rememberRecentDeviceId,
  resolveRecentDevices,
} from './device-recents'

function fakeStorage(initial?: string) {
  const cell = { value: initial }
  return {
    getItem: () => cell.value ?? null,
    setItem: (_key: string, value: string) => { cell.value = value },
    read: () => cell.value,
  }
}

function device(id: string, available = true): DeviceDescriptor {
  return {
    id,
    provider: 'ios-sim',
    platform: 'ios',
    name: `Device ${id}`,
    kind: 'iphone',
    kindName: 'iPhone',
    kindRank: 0,
    model: `Device ${id}`,
    platformVersion: 'iOS 26.5',
    versionRank: 26005,
    running: false,
    available,
  }
}

describe('iOS simulator recents', () => {
  it('puts the newest launch first and never repeats a device', () => {
    const storage = fakeStorage()

    rememberRecentDeviceId('a', storage)
    rememberRecentDeviceId('b', storage)
    const next = rememberRecentDeviceId('a', storage)

    expect(next).toEqual(['a', 'b'])
    expect(readRecentDeviceIds(storage)).toEqual(['a', 'b'])
  })

  it('keeps only the last five launches', () => {
    const storage = fakeStorage()

    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rememberRecentDeviceId(id, storage)

    expect(readRecentDeviceIds(storage)).toEqual(['f', 'e', 'd', 'c', 'b'])
    expect(readRecentDeviceIds(storage)).toHaveLength(DEVICE_RECENT_LIMIT)
  })

  it('survives a corrupt or foreign value in storage', () => {
    expect(readRecentDeviceIds(fakeStorage('not json'))).toEqual([])
    expect(readRecentDeviceIds(fakeStorage('{"udid":"a"}'))).toEqual([])
    expect(readRecentDeviceIds(fakeStorage('["a", 7, null]'))).toEqual(['a'])
  })

  it('keeps the old iOS recents after the storage key migration', () => {
    const store = {
      getItem: (key: string) => key === 'superone.iosSimulator.recentUdids'
        ? '["p17-26"]'
        : null,
    }

    // A bare udid from the oldest spelling, landing on today's provider.
    expect(readRecentDeviceIds(store)).toEqual(['ios-sim:p17-26'])
  })

  it('re-spells an id stored before providers existed', () => {
    // The generation between the two: prefixed, but with the platform where the
    // provider now goes. Left alone it would match nothing in the catalog and the
    // device would silently drop off the recents list.
    expect(readRecentDeviceIds(fakeStorage('["ios:p17-26"]'))).toEqual(['ios-sim:p17-26'])
  })

  it('hides simulators that were deleted or turned unavailable', () => {
    const devices = [device('a'), device('c', false)]

    expect(resolveRecentDevices(['a', 'b', 'c'], devices).map((entry) => entry.id)).toEqual(['a'])
  })
})
