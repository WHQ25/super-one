import { describe, expect, it } from 'vitest'
import {
  adbConnectSucceeded,
  parseAdbDevices,
  parseMdnsConnectTargets,
  parseRebuildArgs,
  rebuildCommands,
  serialsExpoCannotAddress,
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
      runArgs: ['--device', 'UDID', '--no-bundler'],
    })
  })

  it('rejects a missing or invalid platform', () => {
    expect(() => parseRebuildArgs(['--platform'])).toThrow('Missing value for --platform')
    expect(() => parseRebuildArgs(['--platform', '--clean'])).toThrow('Missing value for --platform')
    expect(() => parseRebuildArgs(['--platform', 'web'])).toThrow('--platform must be ios or android')
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
      { serial: 'adb-f43b555-buMqzc._adb-tls-connect._tcp', state: 'device' },
      { serial: '192.168.124.2:33025', state: 'device' },
    ])
  })

  it('keeps the full serial when wireless adb inserts a space for a duplicate', () => {
    // Expo CLI splits this line on spaces and then `adb -s adb-f43b555-buMqzc` fails.
    expect(parseAdbDevices(`List of devices attached
adb-f43b555-buMqzc (2)._adb-tls-connect._tcp device product:haotian model:2410DPN6CC device:haotian transport_id:2
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64
`)).toEqual([
      { serial: 'adb-f43b555-buMqzc (2)._adb-tls-connect._tcp', state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
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

describe('parseMdnsConnectTargets', () => {
  it('reads host:port even when adb glues the record to the address', () => {
    expect(parseMdnsConnectTargets(`List of discovered mdns services
adb-f43b555-buMqzc (2)_adb-tls-connect._tcp192.168.124.2:33025
adb-f43b555-buMqzc_adb-tls-connect._tcp192.168.124.2:38393
adb-f43b555-buMqzc (2)_adb-tls-connect._tcp192.168.124.2:33025
`)).toEqual(['192.168.124.2:33025', '192.168.124.2:38393'])
  })
})

describe('adbConnectSucceeded', () => {
  it('accepts a fresh or already-open socket and rejects a refused port', () => {
    expect(adbConnectSucceeded('connected to 192.168.124.2:33025')).toBe(true)
    expect(adbConnectSucceeded('already connected to 192.168.124.2:33025')).toBe(true)
    expect(adbConnectSucceeded("failed to connect to '192.168.124.2:38393': Connection refused")).toBe(false)
  })
})
