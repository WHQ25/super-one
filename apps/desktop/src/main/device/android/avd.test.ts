import { describe, expect, it } from 'vitest'
import {
  emulatorLaunchArgs,
  parseAvdConfig,
  parseAvdList,
  parseEmuResponse,
  parseIni,
} from './avd'

/** Verbatim `~/.android/avd/Medium_Phone_API_36.1.ini` from this machine. */
const OUTER_INI = `avd.ini.encoding=UTF-8
path=/Users/wuhangqi25/.android/avd/Medium_Phone.avd
path.rel=avd/Medium_Phone.avd
target=android-36.1
`

/** The fields that matter from that AVD's `config.ini`. */
const CONFIG_INI = `AvdId=Medium_Phone_API_36.1
abi.type=arm64-v8a
avd.ini.displayname=Medium Phone API 36.1
hw.device.name=medium_phone
hw.lcd.height=2400
hw.lcd.width=1080
image.sysdir.1=system-images/android-36.1/google_apis_playstore/arm64-v8a/
tag.id=google_apis_playstore
`

describe('parseAvdList', () => {
  it('reads the AVD this machine has installed', () => {
    expect(parseAvdList('Medium_Phone_API_36.1\n')).toEqual(['Medium_Phone_API_36.1'])
  })

  it('ignores the crash-database warning the emulator prints on every run', () => {
    // Observed on this machine every single invocation. It goes to stderr, so a caller
    // that keeps the streams apart never sees it — but a caller that merges them gets
    // a phantom AVD named `[86068:10080979:...]`, which then fails to boot. Filtered
    // here as well, so merging is a performance mistake rather than a correctness one.
    const noisy = `[86068:10080979:20260822,074643.745464:ERROR crash_report_database_mac.mm:109] mkdir /tmp/android-user/emu-crash-36.4.9.db: No such file or directory (2)
Medium_Phone_API_36.1
`
    expect(parseAvdList(noisy)).toEqual(['Medium_Phone_API_36.1'])
  })

  it('answers with nothing when no AVD exists', () => {
    expect(parseAvdList('\n')).toEqual([])
  })
})

describe('parseIni', () => {
  it('reads Android\'s sectionless key=value format', () => {
    expect(parseIni(OUTER_INI)).toEqual({
      'avd.ini.encoding': 'UTF-8',
      path: '/Users/wuhangqi25/.android/avd/Medium_Phone.avd',
      'path.rel': 'avd/Medium_Phone.avd',
      target: 'android-36.1',
    })
  })

  it('keeps a value containing an equals sign whole', () => {
    expect(parseIni('key=a=b')).toEqual({ key: 'a=b' })
  })

  it('skips comments and blank lines', () => {
    expect(parseIni('# note\n\nkey=value\n')).toEqual({ key: 'value' })
  })
})

describe('parseAvdConfig', () => {
  it('describes this machine\'s AVD the way the catalog will show it', () => {
    expect(parseAvdConfig('Medium_Phone_API_36.1', OUTER_INI, CONFIG_INI)).toEqual({
      id: 'Medium_Phone_API_36.1',
      displayName: 'Medium Phone API 36.1',
      deviceProfile: 'medium_phone',
      apiLevel: 36,
      platformVersion: 'Android 16',
      screen: { width: 1080, height: 2400 },
    })
  })

  it('falls back to the system image path when the target is missing', () => {
    const summary = parseAvdConfig('X', '', CONFIG_INI)
    expect(summary.apiLevel).toBe(36)
  })

  it('still produces a usable row for an AVD whose config could not be read', () => {
    // The emulator will boot it regardless, so hiding it would leave the user staring
    // at a catalog missing the device they can see in Android Studio.
    expect(parseAvdConfig('Pixel_7_API_34', '', '')).toMatchObject({
      id: 'Pixel_7_API_34',
      displayName: 'Pixel 7 API 34',
      platformVersion: 'Android',
    })
  })

  it('omits the screen rather than reporting a zero-sized one', () => {
    const summary = parseAvdConfig('X', OUTER_INI, 'hw.lcd.width=0\nhw.lcd.height=abc\n')
    expect(summary.screen).toBeUndefined()
  })
})

describe('parseEmuResponse', () => {
  it('strips the telnet OK that terminates every emulator console reply', () => {
    // Verbatim from `adb -s emulator-5554 emu avd name`. Keeping the OK gives you an
    // AVD named "Medium_Phone_API_36.1\nOK", which then matches nothing in the catalog.
    expect(parseEmuResponse('Medium_Phone_API_36.1\nOK\n')).toBe('Medium_Phone_API_36.1')
  })

  it('treats a KO reply as no answer at all', () => {
    expect(parseEmuResponse('KO: unknown command\n')).toBeNull()
  })

  it('answers null for an empty reply', () => {
    expect(parseEmuResponse('OK\n')).toBeNull()
  })
})

describe('emulatorLaunchArgs', () => {
  it('starts headless, so the emulator has no window to steal the screen with', () => {
    // The structural answer to what iOS can only ask for in prose. There, the agent is
    // told never to run `open -a Simulator` because Apple's window cannot be put back;
    // here the emulator simply renders nowhere.
    expect(emulatorLaunchArgs('Medium_Phone_API_36.1')).toContain('-no-window')
  })

  it('names the AVD the emulator was asked for', () => {
    expect(emulatorLaunchArgs('Medium_Phone_API_36.1').slice(0, 2))
      .toEqual(['-avd', 'Medium_Phone_API_36.1'])
  })

  it('never writes a snapshot on exit', () => {
    // Taking control of a device should not silently rewrite the state the user left
    // it in — and the save costs seconds on every shutdown.
    expect(emulatorLaunchArgs('X')).toContain('-no-snapshot-save')
  })

  it('can be asked for a window, for debugging the emulator itself', () => {
    expect(emulatorLaunchArgs('X', { headless: false })).not.toContain('-no-window')
  })
})
