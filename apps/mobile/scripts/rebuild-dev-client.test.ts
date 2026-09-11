import { describe, expect, it } from 'vitest'
import {
  adbConnectSucceeded,
  baseRebuildEnv,
  hostsFromConnectHints,
  missingAndroidDeviceError,
  parseAdbDevices,
  parseAdbPort,
  parseMdnsConnectTargets,
  parseRebuildArgs,
  pickExpoAndroidDevice,
  pinAndroidDevice,
  expoRunDeviceName,
  rebuildCommands,
  serialsExpoCannotAddress,
  wirelessConnectTargets,
} from './rebuild-dev-client'

describe('parseRebuildArgs', () => {
  it('defaults to ios on macOS and android elsewhere', () => {
    expect(parseRebuildArgs([], 'darwin').platform).toBe('ios')
    expect(parseRebuildArgs([], 'linux').platform).toBe('android')
  })

  it('keeps expo run flags and strips rebuild flags', () => {
    expect(parseRebuildArgs(['--platform', 'ios', '--clean', '--dry-run', '--device', 'UDID', '--no-bundler'], 'linux')).toEqual({
      help: false,
      dryRun: true,
      platform: 'ios',
      clean: true,
      host: undefined,
      port: undefined,
      runArgs: ['--device', 'UDID', '--no-bundler'],
    })
  })

  it('keeps --host and --port off expo run', () => {
    expect(parseRebuildArgs([
      '--platform', 'android', '--host', '192.168.124.2', '--port', '5555', '--no-bundler',
    ], 'linux')).toEqual({
      help: false,
      dryRun: false,
      platform: 'android',
      clean: false,
      host: '192.168.124.2',
      port: 5555,
      runArgs: ['--no-bundler'],
    })
  })

  it('rejects a missing or invalid platform', () => {
    expect(() => parseRebuildArgs(['--platform'])).toThrow('Missing value for --platform')
    expect(() => parseRebuildArgs(['--platform', '--clean'])).toThrow('Missing value for --platform')
    expect(() => parseRebuildArgs(['--platform', 'web'])).toThrow('--platform must be ios or android')
  })

  it('rejects a missing or out-of-range port', () => {
    expect(() => parseRebuildArgs(['--port'])).toThrow('Missing value for --port')
    expect(() => parseAdbPort('nope')).toThrow('--port must be an integer')
    expect(() => parseAdbPort('0')).toThrow('--port must be between 1 and 65535')
    expect(() => parseAdbPort('65536')).toThrow('--port must be between 1 and 65535')
  })
})

describe('rebuildCommands', () => {
  it('puts --clean on prebuild and --no-bundler on expo run', () => {
    expect(rebuildCommands(parseRebuildArgs(['--platform', 'ios', '--clean', '--no-bundler']))).toEqual([
      ['bun', 'run', 'build:chat-view'],
      ['bunx', 'expo', 'prebuild', '-p', 'ios', '--clean'],
      ['bunx', 'expo', 'run:ios', '--no-bundler'],
    ])
  })
})

describe('parseAdbDevices', () => {
  it('keeps a wireless serial that Expo can pass to adb -s', () => {
    expect(parseAdbDevices(`List of devices attached
adb-f43b555-buMqzc._adb-tls-connect._tcp device product:haotian model:2410DPN6CC device:haotian transport_id:1
192.168.124.2:33025 device product:haotian model:2410DPN6CC
`)).toEqual([
      { serial: 'adb-f43b555-buMqzc._adb-tls-connect._tcp', state: 'device', model: '2410DPN6CC' },
      { serial: '192.168.124.2:33025', state: 'device', model: '2410DPN6CC' },
    ])
  })

  it('keeps the full serial when wireless adb inserts a space for a duplicate', () => {
    // Expo CLI splits this line on spaces and then `adb -s adb-f43b555-buMqzc` fails.
    expect(parseAdbDevices(`List of devices attached
adb-f43b555-buMqzc (2)._adb-tls-connect._tcp device product:haotian model:2410DPN6CC device:haotian transport_id:2
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64
`)).toEqual([
      { serial: 'adb-f43b555-buMqzc (2)._adb-tls-connect._tcp', state: 'device', model: '2410DPN6CC' },
      { serial: 'emulator-5554', state: 'device', model: 'sdk_gphone64_arm64' },
    ])
  })
})

describe('pickExpoAndroidDevice', () => {
  it('prefers the IP:port serial adb devices already prints', () => {
    expect(pickExpoAndroidDevice([
      { serial: 'adb-f43b555-buMqzc (2)._adb-tls-connect._tcp', state: 'device', model: '2410DPN6CC' },
      { serial: '192.168.124.2:43481', state: 'device', model: '2410DPN6CC' },
      { serial: 'emulator-5554', state: 'device' },
    ])?.serial).toBe('192.168.124.2:43481')
  })

  it('falls back to an emulator then any Expo-safe serial', () => {
    expect(pickExpoAndroidDevice([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'f43b555', state: 'device' },
    ])?.serial).toBe('emulator-5554')
    expect(pickExpoAndroidDevice([{ serial: 'f43b555', state: 'device' }])?.serial).toBe('f43b555')
  })
})

describe('expoRunDeviceName', () => {
  it('uses adb model: because Expo --device matches name not pid', () => {
    expect(expoRunDeviceName({
      serial: '192.168.124.2:43481',
      state: 'device',
      model: '2410DPN6CC',
    })).toBe('2410DPN6CC')
  })

  it('does not pass an emulator serial as --device', () => {
    expect(expoRunDeviceName({
      serial: 'emulator-5554',
      state: 'device',
      model: 'sdk_gphone64_arm64',
    })).toBeUndefined()
  })
})

describe('pinAndroidDevice', () => {
  it('passes the Expo model name to expo run when the user did not pick a device', () => {
    expect(pinAndroidDevice(['--no-bundler'], '2410DPN6CC')).toEqual([
      '--device', '2410DPN6CC', '--no-bundler',
    ])
  })

  it('leaves an explicit --device alone', () => {
    expect(pinAndroidDevice(['--device', 'emulator-5554'], '2410DPN6CC')).toEqual([
      '--device', 'emulator-5554',
    ])
  })
})

describe('serialsExpoCannotAddress', () => {
  it('drops only serials that contain whitespace', () => {
    expect(serialsExpoCannotAddress([
      { serial: 'adb-f43b555-buMqzc (2)._adb-tls-connect._tcp', state: 'device' },
      { serial: 'adb-f43b555-buMqzc._adb-tls-connect._tcp', state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
    ])).toEqual(['adb-f43b555-buMqzc (2)._adb-tls-connect._tcp'])
  })
})

describe('wirelessConnectTargets', () => {
  const mdns = ['192.168.124.2:33025', '192.168.124.2:38393']
  const devices = [{ serial: '192.168.124.2:43481', state: 'device' }]

  it('puts --host --port ahead of ephemeral mDNS ports', () => {
    expect(wirelessConnectTargets({
      mdnsTargets: mdns,
      host: '192.168.124.2',
      port: 5555,
    })).toEqual(['192.168.124.2:5555', '192.168.124.2:33025', '192.168.124.2:38393'])
  })

  it('remaps discovered IPs onto --port when host is omitted', () => {
    expect(wirelessConnectTargets({ mdnsTargets: mdns, devices, port: 5555 })).toEqual([
      '192.168.124.2:5555',
      '192.168.124.2:33025',
      '192.168.124.2:38393',
    ])
  })

  it('reads IPs from both mDNS and attached serials', () => {
    expect(hostsFromConnectHints(['10.0.0.8:1'], devices)).toEqual(['10.0.0.8', '192.168.124.2'])
  })
})

describe('parseMdnsConnectTargets', () => {
  it('reads host:port even when adb glues the record to the address', () => {
    expect(parseMdnsConnectTargets(`List of discovered mdns services
adb-f43b555-buMqzc (2)_adb-tls-connect._tcp192.168.124.2:33025
adb-f43b555-buMqzc_adb-tls-connect._tcp192.168.124.2:38393
adb-f43b555-buMqzc (2)_adb-tls-connect._tcp192.168.124.2:33025
`)).toEqual(['192.168.124.2:33025', '192.168.124.2:38393'])
  })
})

describe('missingAndroidDeviceError', () => {
  it('says adb is empty when nothing is attached', () => {
    expect(missingAndroidDeviceError([], ['192.168.124.2:38393', '192.168.124.2:43481'])).toContain('adb lists none')
    expect(missingAndroidDeviceError([], ['192.168.124.2:43481'])).toContain('192.168.124.2:43481')
  })

  it('explains Expo-incompatible wireless serials when those are the only devices', () => {
    expect(missingAndroidDeviceError([
      { serial: 'adb-f43b555-buMqzc (2)._adb-tls-connect._tcp', state: 'device' },
    ], [])).toContain('duplicate serial with a space')
  })
})

describe('adbConnectSucceeded', () => {
  it('accepts a fresh or already-open socket and rejects a refused port', () => {
    expect(adbConnectSucceeded('connected to 192.168.124.2:33025')).toBe(true)
    expect(adbConnectSucceeded('already connected to 192.168.124.2:33025')).toBe(true)
    expect(adbConnectSucceeded("failed to connect to '192.168.124.2:38393': Connection refused")).toBe(false)
  })
})

describe('baseRebuildEnv', () => {
  it('pins the UTF-8 locale and the development variant', () => {
    // NODE_ENV is required: Expo augments NodeJS.ProcessEnv with it.
    const env = baseRebuildEnv({ PATH: '/usr/bin', NODE_ENV: 'test' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.LC_ALL).toBe('en_US.UTF-8')
    // Without this the local build takes the release application id and then
    // cannot install over the EAS-signed APK.
    expect(env.APP_VARIANT).toBe('development')
  })
})
