import { describe, expect, it } from 'vitest'
import type { DeviceSetupOption } from '@superone/shared/device-setup'
import { destinationFor, setupOptions, type DeviceSetupProbe } from './setup'

/** A machine with everything, so each test can subtract exactly one thing. */
const complete: DeviceSetupProbe = {
  xcode: true,
  adb: true,
  emulator: true,
  iphoneMirroring: true,
  macos: true,
}

const find = (options: DeviceSetupOption[], kind: DeviceSetupOption['kind']) =>
  options.find((option) => option.kind === kind)

describe('setupOptions', () => {
  it('offers every path on a fully equipped Mac', () => {
    expect(setupOptions(complete).map((option) => option.kind)).toEqual([
      'ios-simulator',
      'android-emulator',
      'android-phone',
      'iphone-mirroring',
    ])
  })

  it('makes only the iOS simulator creatable', () => {
    // The whole point of the seam: three of the four paths end somewhere else, and
    // the menu has to render that difference rather than promise four "New Device"s.
    expect(setupOptions(complete).filter((option) => option.creatable).map((o) => o.kind))
      .toEqual(['ios-simulator'])
  })

  it('leaves a complete Android SDK un-blocked but still not creatable', () => {
    // No blocker means "nothing is missing" — creating the AVD is Android Studio's
    // job. Reporting a blocker here would send the user off to fix a working SDK.
    expect(find(setupOptions(complete), 'android-emulator'))
      .toEqual({ kind: 'android-emulator', creatable: false })
  })

  it('blames the missing SDK before the missing emulator package', () => {
    const options = setupOptions({ ...complete, adb: false, emulator: false })
    expect(find(options, 'android-emulator')?.blocker).toBe('android-sdk-missing')
    expect(find(options, 'android-phone')?.blocker).toBe('android-sdk-missing')
  })

  it('distinguishes platform-tools-only from no SDK at all', () => {
    // adb without the emulator package is a real setup — a machine kept for physical
    // devices. Phones still work there, so only the emulator path is blocked.
    const options = setupOptions({ ...complete, emulator: false })
    expect(find(options, 'android-emulator')?.blocker).toBe('android-emulator-missing')
    expect(find(options, 'android-phone')?.blocker).toBeUndefined()
  })

  it('blocks the simulator when Xcode is missing', () => {
    const option = find(setupOptions({ ...complete, xcode: false }), 'ios-simulator')
    expect(option).toEqual({ kind: 'ios-simulator', creatable: false, blocker: 'xcode-missing' })
  })

  it('blocks mirroring when the app is absent', () => {
    expect(find(setupOptions({ ...complete, iphoneMirroring: false }), 'iphone-mirroring')?.blocker)
      .toBe('macos-too-old')
  })

  it('omits both iOS paths off a Mac rather than showing them permanently disabled', () => {
    const options = setupOptions({
      xcode: false,
      adb: true,
      emulator: true,
      iphoneMirroring: false,
      macos: false,
    })
    expect(options.map((option) => option.kind)).toEqual(['android-emulator', 'android-phone'])
  })
})

describe('destinationFor', () => {
  const installed = () => true
  const absent = () => false

  it('opens an installed Android Studio for the emulator path', () => {
    expect(destinationFor({ kind: 'android-emulator', creatable: false }, installed))
      .toEqual({ app: '/Applications/Android Studio.app' })
  })

  it('falls back to the download page when Android Studio is not installed', () => {
    expect(destinationFor({ kind: 'android-emulator', creatable: false }, absent))
      .toEqual({ url: 'https://developer.android.com/studio' })
  })

  it('sends a phone with no SDK to the SDK, and one with an SDK to USB debugging', () => {
    expect(destinationFor(
      { kind: 'android-phone', creatable: false, blocker: 'android-sdk-missing' },
      installed,
    )).toEqual({ url: 'https://developer.android.com/studio' })
    expect(destinationFor({ kind: 'android-phone', creatable: false }, installed))
      .toEqual({ url: 'https://developer.android.com/studio/debug/dev-options' })
  })

  it('launches iPhone Mirroring when it exists and explains it when it does not', () => {
    expect(destinationFor({ kind: 'iphone-mirroring', creatable: false }, installed))
      .toEqual({ app: '/System/Applications/iPhone Mirroring.app' })
    expect(destinationFor(
      { kind: 'iphone-mirroring', creatable: false, blocker: 'macos-too-old' },
      installed,
    )).toEqual({ url: 'https://support.apple.com/guide/mac-help/mchlbb2c87c6/mac' })
  })
})
