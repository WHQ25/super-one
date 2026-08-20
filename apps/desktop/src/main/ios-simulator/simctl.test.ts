import { describe, expect, it, vi } from 'vitest'
import { SimctlClient, parseSimctlDevices, parseSimctlRuntimes } from './simctl'

const RUNTIME_JSON = JSON.stringify({
  runtimes: [
    {
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5',
      version: '17.5',
      isAvailable: true,
      supportedDeviceTypes: [
        { name: 'iPhone 15 Pro', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro', productFamily: 'iPhone' },
      ],
    },
    {
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      version: '26.5',
      isAvailable: true,
      supportedDeviceTypes: [
        { name: 'iPhone 17 Pro', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', productFamily: 'iPhone' },
        { name: 'iPad (A16)', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-A16', productFamily: 'iPad' },
      ],
    },
    // Two Xcode installs can advertise the same runtime twice.
    {
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      version: '26.5',
      isAvailable: true,
      supportedDeviceTypes: [],
    },
    {
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-16-0',
      version: '16.0',
      isAvailable: false,
      supportedDeviceTypes: [],
    },
  ],
})

const DEVICE_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
      {
        dataPath: '/tmp/device-a',
        logPath: '/tmp/device-a/logs',
        udid: 'AAAA-BBBB',
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
        state: 'Booted',
        name: 'iPhone 17 Pro',
      },
      {
        udid: 'CCCC-DDDD',
        isAvailable: false,
        availabilityError: 'runtime profile not found',
        state: 'Shutdown',
        name: 'Unavailable Phone',
      },
      {
        udid: 'EEEE-FFFF',
        isAvailable: true,
        state: 'Shutdown',
        name: 'iPhone 17',
      },
    ],
  },
})

describe('parseSimctlDevices', () => {
  it('flattens runtimes and preserves unavailable devices for diagnostics', () => {
    expect(parseSimctlDevices(DEVICE_JSON)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        udid: 'AAAA-BBBB',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
        runtimeName: 'iOS 26.0',
        booted: true,
        available: true,
      }),
      expect.objectContaining({
        udid: 'CCCC-DDDD',
        available: false,
        availabilityError: 'runtime profile not found',
      }),
    ]))
  })

  it('formats non-iOS runtime names too, and calls xrOS by its product name', () => {
    const raw = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
          { udid: 'W1', isAvailable: true, state: 'Shutdown', name: 'Apple Watch Series 10 (46mm)' },
        ],
        'com.apple.CoreSimulator.SimRuntime.xrOS-2-0': [
          { udid: 'V1', isAvailable: true, state: 'Shutdown', name: 'Apple Vision Pro' },
        ],
      },
    })

    expect(parseSimctlDevices(raw).map((device) => device.runtimeName).sort())
      .toEqual(['visionOS 2.0', 'watchOS 11.0'])
  })
})

describe('SimctlClient', () => {
  it('boots only shutdown devices and waits for bootstatus', async () => {
    const runText = vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'simctl list devices --json') return DEVICE_JSON
      return ''
    })
    const client = new SimctlClient({ runText })

    await client.boot('EEEE-FFFF')

    expect(runText).toHaveBeenCalledWith(['simctl', 'boot', 'EEEE-FFFF'])
    expect(runText).toHaveBeenCalledWith(['simctl', 'bootstatus', 'EEEE-FFFF', '-b'])
  })

  it('does not boot an already booted device', async () => {
    const runText = vi.fn(async () => DEVICE_JSON)
    const client = new SimctlClient({ runText })

    await client.boot('AAAA-BBBB')

    expect(runText).toHaveBeenCalledTimes(1)
  })

  it('creates a device and returns the udid simctl printed', async () => {
    const runText = vi.fn(async () => 'NEW-UDID-1234\n')
    const client = new SimctlClient({ runText })

    const udid = await client.create({
      name: 'My iPhone',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    })

    expect(udid).toBe('NEW-UDID-1234')
    expect(runText).toHaveBeenCalledWith([
      'simctl', 'create', 'My iPhone',
      'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    ])
  })

  it('rejects a blank device name before shelling out', async () => {
    const runText = vi.fn(async () => '')
    const client = new SimctlClient({ runText })

    await expect(client.create({
      name: '   ',
      deviceTypeIdentifier: 'type',
      runtimeIdentifier: 'runtime',
    })).rejects.toThrow(/name/i)
    expect(runText).not.toHaveBeenCalled()
  })
})

describe('parseSimctlRuntimes', () => {
  it('keeps available runtimes, drops duplicate identifiers, and sorts newest first', () => {
    const runtimes = parseSimctlRuntimes(RUNTIME_JSON)

    expect(runtimes.map((runtime) => runtime.name)).toEqual(['iOS 26.5', 'iOS 17.5'])
    expect(runtimes[0]!.deviceTypes.map((type) => type.name)).toEqual(['iPhone 17 Pro', 'iPad (A16)'])
  })
})
