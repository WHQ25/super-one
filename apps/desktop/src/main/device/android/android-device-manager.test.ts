import { describe, expect, it, vi } from 'vitest'
import { Adb, type AdbResult, type RunAdb } from './adb'
import { Avd } from './avd'
import {
  AndroidDeviceManager,
  avdIdFromDeviceId,
  type AndroidToolchain,
} from './android-device-manager'

const AVD_ID = 'Medium_Phone_API_36.1'
const SERIAL = 'emulator-5554'
/** A phone, so a second device is reachable without a second AVD to fake. */
const PHONE_SERIAL = 'R5CT30ABCDE'

const DEVICES_OUTPUT = `List of devices attached
${SERIAL}          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:2

`

/** The emulator above plus a phone, for the tests that move a session between two. */
const TWO_DEVICES_OUTPUT = `List of devices attached
${SERIAL}          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:2
${PHONE_SERIAL}          device product:a54x model:SM_A546B device:a54x transport_id:3

`

/**
 * Stands in for a real scrcpy connection. Every one built here is remembered, so a
 * test can assert on the one that should have been taken down.
 */
const scrcpy = vi.hoisted(() => ({
  connections: [] as { serial: string; closed: boolean }[],
}))

vi.mock('./scrcpy-server', () => ({
  connectScrcpy: vi.fn(async (options: { serial: string }) => {
    const connection = { serial: options.serial, closed: false }
    scrcpy.connections.push(connection)
    return {
      deviceName: options.serial,
      screen: { width: 720, height: 1600 },
      onMedia: () => () => {},
      onSession: () => () => {},
      onClosed: () => () => {},
      send: () => {},
      close: async () => { connection.closed = true },
    }
  }),
}))

function ok(text: string): AdbResult {
  return { stdout: Buffer.from(text), stderr: '', code: 0 }
}

/**
 * A toolchain wired to canned command output.
 *
 * The real `Adb` and `Avd` classes wrap it rather than being faked themselves, so
 * these exercise the actual argument construction and output parsing — the parts most
 * likely to drift from what the tools accept.
 */
function toolchain(options: { avds?: string; devices?: string } = {}): {
  toolchain: AndroidToolchain
  calls: string[][]
} {
  const calls: string[][] = []
  const respond: RunAdb = async (args) => {
    calls.push([...args])
    const joined = args.join(' ')
    if (joined === '-list-avds') return ok(options.avds ?? `${AVD_ID}\n`)
    if (joined === 'devices -l') return ok(options.devices ?? DEVICES_OUTPUT)
    if (joined.includes('emu avd name')) return ok(`${AVD_ID}\nOK\n`)
    if (joined.includes('ro.build.version.sdk')) return ok('36\n')
    if (joined.includes('ro.product.model')) return ok('sdk_gphone64_arm64\n')
    if (joined.includes('ro.build.characteristics')) return ok('emulator\n')
    if (joined.includes('sys.boot_completed')) return ok('1\n')
    return ok('')
  }
  return {
    calls,
    toolchain: {
      adb: new Adb(respond),
      // A home that does not exist, so config reading falls back to deriving a name
      // from the id — deterministic, and the same path a machine with a half-written
      // AVD directory takes.
      avd: new Avd('/nonexistent/emulator', respond, '/nonexistent/avd'),
      adbBinary: '/nonexistent/adb',
    },
  }
}

describe('avdIdFromDeviceId', () => {
  it('recovers the AVD name from a catalog handle', () => {
    expect(avdIdFromDeviceId(`android:avd:${AVD_ID}`)).toBe(AVD_ID)
  })

  it('declines a serial handle, which names no AVD to launch', () => {
    expect(avdIdFromDeviceId('android:emulator-5554')).toBeNull()
    expect(avdIdFromDeviceId('ios:ABC-123')).toBeNull()
  })

  it('keeps an AVD name containing a colon whole', () => {
    expect(avdIdFromDeviceId('android:avd:weird:name')).toBe('weird:name')
  })
})

describe('listing devices', () => {
  it('joins the AVD list and adb into one running device', async () => {
    const { toolchain: tools } = toolchain()
    const devices = await new AndroidDeviceManager(tools).listDevices()

    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      id: `android:avd:${AVD_ID}`,
      platform: 'android',
      running: true,
      platformVersion: 'Android 16',
    })
  })

  it('remembers the serial to address the device by', async () => {
    // The catalog id is stable across boots and adb has never heard of it; every
    // actual command needs the serial, so losing this mapping breaks everything
    // downstream while the catalog still looks fine.
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.listDevices()

    expect(manager.serialFor(`android:avd:${AVD_ID}`)).toBe(SERIAL)
  })

  it('does not interrogate a device that cannot answer', async () => {
    // An unauthorized phone times out on every getprop. Asking anyway would add
    // seconds to a list whose whole job is to be quick.
    const { toolchain: tools, calls } = toolchain({
      devices: 'List of devices attached\nABC123    unauthorized usb:1\n',
      avds: '\n',
    })
    const devices = await new AndroidDeviceManager(tools).listDevices()

    expect(devices[0]).toMatchObject({ available: false })
    expect(calls.some((call) => call.join(' ').includes('getprop'))).toBe(false)
  })

  it('still lists AVDs when adb itself is broken', async () => {
    const failing: RunAdb = async (args) => {
      if (args.join(' ') === '-list-avds') return ok(`${AVD_ID}\n`)
      return { stdout: Buffer.from(''), stderr: 'adb: not found', code: 1 }
    }
    const devices = await new AndroidDeviceManager({
      adb: new Adb(failing),
      avd: new Avd('/nonexistent/emulator', failing, '/nonexistent/avd'),
      adbBinary: '/nonexistent/adb',
    }).listDevices()

    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ running: false })
  })
})

describe('ownership', () => {
  it('reports nothing controlled before anything is granted', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.listDevices()

    expect(manager.controlled('session-1')).toBeNull()
  })

  it('hands the device to the session that was granted it', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    const device = await manager.boot('session-1', `android:avd:${AVD_ID}`)

    expect(device).toMatchObject({ boundSessionId: 'session-1' })
    expect(manager.controlled('session-1')?.id).toBe(`android:avd:${AVD_ID}`)
  }, 20_000)

  it('takes the device away from the session that had it', async () => {
    // Allowed on purpose — the user approved the transfer — but the previous owner
    // must actually lose it, or two sessions both believe they are driving.
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.boot('session-1', `android:avd:${AVD_ID}`)
    await manager.boot('session-2', `android:avd:${AVD_ID}`)

    expect(manager.controlled('session-2')?.id).toBe(`android:avd:${AVD_ID}`)
    expect(manager.controlled('session-1')).toBeNull()
  }, 20_000)

  it('frees the device when the session lets go', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.boot('session-1', `android:avd:${AVD_ID}`)
    manager.release('session-1')

    expect(manager.controlled('session-1')).toBeNull()
    const devices = await manager.listDevices()
    expect(devices[0]?.boundSessionId).toBeUndefined()
  }, 20_000)

  it('refuses a handle that names neither a running device nor an AVD', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)

    expect(await manager.boot('session-1', 'android:no-such-phone')).toBeNull()
  })
})


describe('rebinding a session', () => {
  const PHONE_ID = `android:${PHONE_SERIAL}`
  const AVD_DEVICE_ID = `android:avd:${AVD_ID}`

  function manager() {
    scrcpy.connections.length = 0
    return new AndroidDeviceManager(toolchain({ devices: TWO_DEVICES_OUTPUT }).toolchain)
  }

  it('closes the connection pointing at the device a session just left', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection('session-1')
    expect(scrcpy.connections[0]!.serial).toBe(SERIAL)

    await android.boot('session-1', PHONE_ID)

    // Left open, the next subscribe would be handed this one back out of the
    // session-keyed cache and the panel would keep watching the emulator.
    expect(scrcpy.connections[0]!.closed).toBe(true)
    await android.connection('session-1')
    expect(scrcpy.connections[1]!.serial).toBe(PHONE_SERIAL)
  })

  it('leaves the video alone when a session rebinds the device it already holds', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection('session-1')

    await android.boot('session-1', AVD_DEVICE_ID)

    expect(scrcpy.connections).toHaveLength(1)
    expect(scrcpy.connections[0]!.closed).toBe(false)
  })

  it('takes the displaced session down with the grant it lost', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection('session-1')
    const announced: string[] = []
    android.onSessionState((state) => {
      if (!state.device) announced.push(state.sessionId)
    })

    await android.boot('session-2', AVD_DEVICE_ID)

    // A second encoder on the same guest, feeding a panel that no longer owns it.
    expect(scrcpy.connections[0]!.closed).toBe(true)
    expect(android.holdsSession('session-1')).toBe(false)
    // And its panel hears about it, rather than sitting on its last frame as `ready`.
    expect(announced).toContain('session-1')
  })
})
