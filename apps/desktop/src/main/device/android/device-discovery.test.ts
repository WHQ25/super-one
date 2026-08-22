import { describe, expect, it } from 'vitest'
import type { AdbDevice } from './adb'
import type { AvdSummary } from './avd'
import {
  androidKind,
  avdDeviceId,
  mergeAndroidDevices,
  serialDeviceId,
  type AndroidRuntimeInfo,
} from './device-discovery'

/** This repo's AVD, as `avd.ts` reports it. */
const MEDIUM_PHONE: AvdSummary = {
  id: 'Medium_Phone_API_36.1',
  displayName: 'Medium Phone API 36.1',
  deviceProfile: 'medium_phone',
  apiLevel: 36,
  platformVersion: 'Android 16',
  screen: { width: 1080, height: 2400 },
}

/** That AVD once booted, as `adb devices -l` reports it. */
const BOOTED: AdbDevice = {
  serial: 'emulator-5554',
  state: 'device',
  properties: {
    product: 'sdk_gphone64_arm64',
    model: 'sdk_gphone64_arm64',
    device: 'emu64a',
    transport_id: '2',
  },
}

function runtime(...infos: AndroidRuntimeInfo[]): Map<string, AndroidRuntimeInfo> {
  return new Map(infos.map((info) => [info.serial, info]))
}

describe('an AVD that has not been started', () => {
  it('is offered, because that is most of what a machine has', () => {
    const [device] = mergeAndroidDevices({
      avds: [MEDIUM_PHONE],
      attached: [],
      runtime: runtime(),
    })
    expect(device).toMatchObject({
      id: 'android:avd:Medium_Phone_API_36.1',
      platform: 'android',
      name: 'Medium Phone API 36.1',
      kind: 'phone',
      platformVersion: 'Android 16',
      running: false,
      available: true,
    })
  })
})

describe('an AVD that is running', () => {
  it('appears once, not twice under two names', () => {
    // It is in both sources — as `Medium_Phone_API_36.1` and as `emulator-5554`. Listing
    // both would offer the user the same device twice, and booting the second copy.
    const devices = mergeAndroidDevices({
      avds: [MEDIUM_PHONE],
      attached: [BOOTED],
      runtime: runtime({ serial: 'emulator-5554', avdId: 'Medium_Phone_API_36.1', apiLevel: 36 }),
    })
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      id: 'android:avd:Medium_Phone_API_36.1',
      running: true,
    })
  })

  it('keeps the stable AVD handle rather than the port it happens to have', () => {
    // `emulator-5554` changes between boots; the AVD id does not. A grant recorded
    // against the port would point at a different device tomorrow.
    const [device] = mergeAndroidDevices({
      avds: [MEDIUM_PHONE],
      attached: [BOOTED],
      runtime: runtime({ serial: 'emulator-5554', avdId: 'Medium_Phone_API_36.1' }),
    })
    expect(device?.id).toBe(avdDeviceId('Medium_Phone_API_36.1'))
    expect(device?.id).not.toContain('5554')
  })

  it('prefers the API level the device reports over the one its config claims', () => {
    const [device] = mergeAndroidDevices({
      avds: [{ ...MEDIUM_PHONE, apiLevel: 34 }],
      attached: [BOOTED],
      runtime: runtime({ serial: 'emulator-5554', avdId: 'Medium_Phone_API_36.1', apiLevel: 36 }),
    })
    expect(device?.platformVersion).toBe('Android 16')
  })

  it('falls back to listing it by serial when its AVD name cannot be read', () => {
    // An emulator whose console refused, or whose AVD was deleted while it ran. It is
    // still a real device someone can drive.
    const devices = mergeAndroidDevices({
      avds: [MEDIUM_PHONE],
      attached: [BOOTED],
      runtime: runtime({ serial: 'emulator-5554' }),
    })
    expect(devices.map((device) => device.id)).toEqual([
      'android:avd:Medium_Phone_API_36.1',
      'android:emulator-5554',
    ])
  })
})

describe('a cable-attached phone', () => {
  it('is listed from adb alone, since no AVD describes it', () => {
    const devices = mergeAndroidDevices({
      avds: [],
      attached: [{ serial: '39061FDJH00BQZ', state: 'device', properties: { model: 'Pixel_8' } }],
      runtime: runtime({
        serial: '39061FDJH00BQZ',
        model: 'Pixel 8',
        apiLevel: 35,
        characteristics: 'default',
      }),
    })
    expect(devices[0]).toMatchObject({
      id: serialDeviceId('39061FDJH00BQZ'),
      name: 'Pixel 8',
      kind: 'phone',
      platformVersion: 'Android 15',
      running: true,
      available: true,
    })
  })

  it('is offered but marked unavailable when its debugging prompt is unanswered', () => {
    // Hiding it would leave the user with nothing to fix. Offering it as usable would
    // produce a grant they approve and a connection that refuses everything.
    const [device] = mergeAndroidDevices({
      avds: [],
      attached: [{ serial: 'ABC123', state: 'unauthorized', properties: {} }],
      runtime: runtime(),
    })
    expect(device).toMatchObject({ available: false, running: true })
  })

  it('is named for the box it came in, not the part number in ro.product.model', () => {
    // Every vendor but Google puts a part number in `ro.product.model`. The name a
    // person would recognize lives in a property Android does not define.
    const [device] = mergeAndroidDevices({
      avds: [],
      attached: [{ serial: 'adb-f43b555._adb-tls-connect._tcp', state: 'device', properties: {} }],
      runtime: runtime({
        serial: 'adb-f43b555._adb-tls-connect._tcp',
        model: '2410DPN6CC',
        marketName: 'Xiaomi 15 Pro',
        characteristics: 'nosdcard',
        apiLevel: 36,
      }),
    })
    expect(device).toMatchObject({ name: 'Xiaomi 15 Pro', model: 'Xiaomi 15 Pro', kind: 'phone' })
  })

  it('falls back to the part number when no vendor recorded a market name', () => {
    const [device] = mergeAndroidDevices({
      avds: [],
      attached: [{ serial: 'x', state: 'device', properties: {} }],
      runtime: runtime({ serial: 'x', model: 'SM-S928B' }),
    })
    expect(device?.name).toBe('SM-S928B')
  })

  it('reads a model adb reported with underscores the way a person writes it', () => {
    const [device] = mergeAndroidDevices({
      avds: [],
      attached: [{ serial: 'x', state: 'device', properties: { model: 'sdk_gphone64_arm64' } }],
      runtime: runtime(),
    })
    expect(device?.name).toBe('sdk gphone64 arm64')
  })
})

describe('androidKind', () => {
  it('reads the family off an AVD hardware profile', () => {
    expect(androidKind('medium_phone').kind).toBe('phone')
    expect(androidKind('pixel_tablet').kind).toBe('tablet')
    expect(androidKind('tv_1080p').kind).toBe('tv')
    expect(androidKind('wear_round').kind).toBe('wear')
  })

  it('prefers the more specific family when a profile matches two', () => {
    // `pixel_fold` matches the handset pattern through "pixel" and the foldable
    // pattern through "fold". A plain find over the list would answer phone, which is
    // true but useless — the whole point of the row is that it folds.
    expect(androidKind('pixel_fold').kind).toBe('foldable')
    expect(androidKind('7.6in Foldable').kind).toBe('foldable')
  })

  it('assumes a handset for something it does not recognize but adb calls a device', () => {
    expect(androidKind('Galaxy S24').kind).toBe('phone')
  })

  it('calls an unrecognized device a phone, because that is what one almost always is', () => {
    // `ro.build.characteristics` plus a vendor part number, which is everything a real
    // Xiaomi 15 Pro says about itself. None of it shares a word with an AVD profile.
    expect(androidKind('nosdcard 2410DPN6CC').kind).toBe('phone')
    expect(androidKind('default SM-S928B').kind).toBe('phone')
  })

  it('does not read the car in nosdcard as Android Auto', () => {
    // `car` unanchored matches inside `nosdcard`, which is what an ordinary phone
    // reports — and filed every one of them under Android Auto.
    expect(androidKind('nosdcard 2410DPN6CC').kind).not.toBe('auto')
    expect(androidKind('automotive_1024p_landscape').kind).toBe('auto')
    expect(androidKind('car_1080p').kind).toBe('auto')
  })

  it('says other rather than guessing when there is nothing to go on', () => {
    expect(androidKind('').kind).toBe('other')
  })

  it('orders phones ahead of everything else', () => {
    expect(androidKind('medium_phone').rank).toBe(0)
    expect(androidKind('pixel_tablet').rank).toBeGreaterThan(0)
  })
})

describe('ownership', () => {
  it('marks the session currently driving a device', () => {
    const [device] = mergeAndroidDevices({
      avds: [MEDIUM_PHONE],
      attached: [],
      runtime: runtime(),
      owners: new Map([[avdDeviceId('Medium_Phone_API_36.1'), 'session-1']]),
    })
    expect(device?.boundSessionId).toBe('session-1')
  })
})
