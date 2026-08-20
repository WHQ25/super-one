import { describe, expect, it } from 'vitest'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import {
  IOS_SIMULATOR_RECENT_LIMIT,
  readRecentUdids,
  rememberRecentUdid,
  resolveRecentDevices,
} from './ios-simulator-recents'

function fakeStorage(initial?: string) {
  const cell = { value: initial }
  return {
    getItem: () => cell.value ?? null,
    setItem: (_key: string, value: string) => { cell.value = value },
    read: () => cell.value,
  }
}

function device(udid: string, available = true): IosSimulatorDevice {
  return {
    udid,
    name: `Device ${udid}`,
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    runtimeName: 'iOS 26.5',
    state: 'Shutdown',
    booted: false,
    available,
    ownedBySuperOne: false,
  }
}

describe('iOS simulator recents', () => {
  it('puts the newest launch first and never repeats a device', () => {
    const storage = fakeStorage()

    rememberRecentUdid('a', storage)
    rememberRecentUdid('b', storage)
    const next = rememberRecentUdid('a', storage)

    expect(next).toEqual(['a', 'b'])
    expect(readRecentUdids(storage)).toEqual(['a', 'b'])
  })

  it('keeps only the last five launches', () => {
    const storage = fakeStorage()

    for (const udid of ['a', 'b', 'c', 'd', 'e', 'f']) rememberRecentUdid(udid, storage)

    expect(readRecentUdids(storage)).toEqual(['f', 'e', 'd', 'c', 'b'])
    expect(readRecentUdids(storage)).toHaveLength(IOS_SIMULATOR_RECENT_LIMIT)
  })

  it('survives a corrupt or foreign value in storage', () => {
    expect(readRecentUdids(fakeStorage('not json'))).toEqual([])
    expect(readRecentUdids(fakeStorage('{"udid":"a"}'))).toEqual([])
    expect(readRecentUdids(fakeStorage('["a", 7, null]'))).toEqual(['a'])
  })

  it('hides simulators that were deleted or turned unavailable', () => {
    const devices = [device('a'), device('c', false)]

    expect(resolveRecentDevices(['a', 'b', 'c'], devices).map((entry) => entry.udid)).toEqual(['a'])
  })
})
