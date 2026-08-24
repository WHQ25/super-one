import { describe, expect, it, vi } from 'vitest'
import type { DeviceFrame } from '@superone/shared/device'
import { Adb, type AdbResult, type RunAdb } from './adb'
import { Avd } from './avd'
import {
  AndroidDeviceManager,
  avdIdFromDeviceId,
  type AndroidScreenRecordingController,
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
  failures: 0,
  connections: [] as {
    serial: string
    closed: boolean
    emit: (packet: unknown) => void
    sent: number[]
  }[],
}))

vi.mock('./scrcpy-server', () => ({
  connectScrcpy: vi.fn(async (options: { serial: string }) => {
    if (scrcpy.failures > 0) {
      scrcpy.failures -= 1
      throw new Error('video socket closed before its header arrived')
    }
    const listeners = new Set<(packet: unknown) => void>()
    const connection = {
      serial: options.serial,
      closed: false,
      emit: (packet: unknown) => { for (const listener of listeners) listener(packet) },
      sent: [] as number[],
    }
    scrcpy.connections.push(connection)
    return {
      deviceName: options.serial,
      screen: { width: 720, height: 1600 },
      onMedia: (listener: (packet: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      onSession: () => () => {},
      onClosed: () => () => {},
      send: (message: Buffer) => { connection.sent.push(message[0]!) },
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
function toolchain(options: {
  avds?: string
  /** A thunk when the catalog changes mid-test — an emulator on its way out. */
  devices?: string | (() => string)
} = {}): {
  toolchain: AndroidToolchain
  calls: string[][]
} {
  const calls: string[][] = []
  const respond: RunAdb = async (args) => {
    calls.push([...args])
    const joined = args.join(' ')
    if (joined === '-list-avds') return ok(options.avds ?? `${AVD_ID}\n`)
    if (joined === 'devices -l') {
      return ok(typeof options.devices === 'function' ? options.devices() : options.devices ?? DEVICES_OUTPUT)
    }
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

    expect(manager.devicesOf('session-1')).toEqual([])
  })

  it('hands the device to the session that was granted it', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    const device = await manager.boot('session-1', `android:avd:${AVD_ID}`)

    expect(device).toMatchObject({ boundSessionId: 'session-1' })
    expect(manager.devicesOf('session-1')).toEqual([`android:avd:${AVD_ID}`])
  }, 20_000)

  it('takes the device away from the session that had it', async () => {
    // Allowed on purpose — the user approved the transfer — but the previous owner
    // must actually lose it, or two sessions both believe they are driving.
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.boot('session-1', `android:avd:${AVD_ID}`)
    await manager.boot('session-2', `android:avd:${AVD_ID}`)

    expect(manager.devicesOf('session-2')).toEqual([`android:avd:${AVD_ID}`])
    expect(manager.devicesOf('session-1')).toEqual([])
  }, 20_000)

  it('frees the device when the tab watching it lets go', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)
    await manager.boot('session-1', `android:avd:${AVD_ID}`)
    // By device, not by session: a session may have a second tab on a second phone,
    // and closing this one says nothing about that one.
    manager.release(`android:avd:${AVD_ID}`)

    expect(manager.devicesOf('session-1')).toEqual([])
    const devices = await manager.listDevices()
    expect(devices[0]?.boundSessionId).toBeUndefined()
  }, 20_000)

  it('refuses a handle that names neither a running device nor an AVD', async () => {
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools)

    expect(await manager.boot('session-1', 'android:no-such-phone')).toBeNull()
  })
})

describe('recording lifecycle', () => {
  it('addresses the bound serial and finalizes recording when the device is released', async () => {
    const capture = { kind: 'recording' as const, path: '/tmp/clip.mp4', fileName: 'clip.mp4' }
    const recorder: AndroidScreenRecordingController = {
      isRecording: vi.fn(() => true),
      start: vi.fn(async () => capture),
      stop: vi.fn(async () => capture),
      stopAll: vi.fn(async () => {}),
    }
    const { toolchain: tools } = toolchain()
    const manager = new AndroidDeviceManager(tools, recorder)
    const deviceId = `android:avd:${AVD_ID}`
    await manager.boot('session-1', deviceId)

    await expect(manager.startRecording(deviceId, '/tmp/captures')).resolves.toEqual(capture)
    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      deviceId,
      serial: SERIAL,
      captureRoot: '/tmp/captures',
    }))

    await manager.release(deviceId)
    expect(recorder.stop).toHaveBeenCalledWith(deviceId)
    await manager.dispose()
    expect(recorder.stopAll).toHaveBeenCalledOnce()
  })
})


describe('rebinding a session', () => {
  const PHONE_ID = `android:${PHONE_SERIAL}`
  const AVD_DEVICE_ID = `android:avd:${AVD_ID}`

  function manager() {
    scrcpy.connections.length = 0
    return new AndroidDeviceManager(toolchain({ devices: TWO_DEVICES_OUTPUT }).toolchain)
  }

  it('keeps both devices live when a session takes a second one', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection(AVD_DEVICE_ID)

    await android.boot('session-1', PHONE_ID)
    await android.connection(PHONE_ID)

    // The point of keying by device: an emulator and a phone, watched side by side.
    // Taking a second one used to close the first, because a session could only mean
    // one device and "another boot" could only mean "swap".
    expect(scrcpy.connections.map((entry) => entry.serial)).toEqual([SERIAL, PHONE_SERIAL])
    expect(scrcpy.connections.every((entry) => !entry.closed)).toBe(true)
    expect(android.devicesOf('session-1').sort()).toEqual([AVD_DEVICE_ID, PHONE_ID].sort())
  })

  it('opens one connection per device, however often it is asked for', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection(AVD_DEVICE_ID)

    await android.connection(AVD_DEVICE_ID)

    // A second connection would mean a second encoder on the guest and two sets of
    // touches arriving out of order.
    expect(scrcpy.connections).toHaveLength(1)
    expect(scrcpy.connections[0]!.closed).toBe(false)
  })

  it('retries a transient scrcpy startup failure without waiting for another action', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    scrcpy.failures = 1

    await expect(android.connection(AVD_DEVICE_ID)).resolves.toMatchObject({
      deviceName: SERIAL,
    })
    expect(scrcpy.failures).toBe(0)
    expect(scrcpy.connections).toHaveLength(1)
  })

  it('closes the connection when a device is given up', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection(AVD_DEVICE_ID)

    android.release(AVD_DEVICE_ID)

    // The encoder on the guest runs for whoever is watching. Nobody is now.
    expect(scrcpy.connections[0]!.closed).toBe(true)
    expect(android.devicesOf('session-1')).toEqual([])
  })

  /**
   * How a displaced session finds out, now that state is keyed by device.
   *
   * There is no message addressed to the loser any more, and there does not need to
   * be: both panels subscribe to this DEVICE, so both are handed the same reading,
   * and the one whose session id is no longer `owner` has been told. A message aimed
   * at the loser was only ever needed while a panel could not hear about a device it
   * did not already believe was its own.
   */
  it('names the new owner in the device\'s own state, which is what tells the old one', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    await android.connection(AVD_DEVICE_ID)
    const announced: { deviceId: string; owner: string | null }[] = []
    android.onState((state) => { announced.push({ deviceId: state.deviceId, owner: state.owner }) })

    await android.boot('session-2', AVD_DEVICE_ID)

    // The connection survives -- the new owner wants the same picture, and tearing it
    // down would cost them a reconnect. What must not survive is the old owner's
    // belief that it is still driving.
    expect(scrcpy.connections[0]!.closed).toBe(false)
    expect(android.devicesOf('session-1')).toEqual([])
    expect(android.devicesOf('session-2')).toEqual([AVD_DEVICE_ID])
    expect(announced).toContainEqual({ deviceId: AVD_DEVICE_ID, owner: 'session-2' })
  })
})

/**
 * Shutting a device down, which is where Android differs most from the simulator.
 *
 * The emulator outlives the app that started it — `emulator` execs into a qemu process
 * that is reparented when this app restarts — so a signal aimed at a remembered child
 * is not a mechanism that survives a restart. The console is.
 */
describe('stopping a device', () => {
  const AVD_DEVICE_ID = `android:avd:${AVD_ID}`
  const PHONE_ID = `android:${PHONE_SERIAL}`
  const NO_DEVICES_OUTPUT = 'List of devices attached\n\n'

  it('kills an emulator this app never launched, which is every emulator after a restart', async () => {
    let killed = false
    const { toolchain: tools, calls } = toolchain({
      devices: () => (killed ? NO_DEVICES_OUTPUT : DEVICES_OUTPUT),
    })
    const android = new AndroidDeviceManager(tools)
    await android.listDevices()
    // No `boot` — nothing is in `launched`, exactly as after the app was restarted
    // under a running emulator. That used to mean the stop signal went nowhere.
    const emuKill = calls.find((args) => args.join(' ').includes('emu kill'))
    expect(emuKill).toBeUndefined()

    const stopping = android.stopDevice(AVD_DEVICE_ID)
    killed = true
    await stopping

    expect(calls).toContainEqual(['-s', SERIAL, 'emu', 'kill'])
    expect(android.serialFor(AVD_DEVICE_ID)).toBeNull()
  })

  it('returns only once adb has stopped reporting the device', async () => {
    // The emulator takes seconds to go, and the panel re-reads the catalog the moment
    // this resolves — so resolving early is what leaves it marked running.
    let remaining = 2
    const { toolchain: tools } = toolchain({
      devices: () => {
        if (remaining <= 0) return NO_DEVICES_OUTPUT
        remaining -= 1
        return DEVICES_OUTPUT
      },
    })
    const android = new AndroidDeviceManager(tools)
    await android.listDevices()

    await android.stopDevice(AVD_DEVICE_ID)

    expect(remaining).toBe(0)
    const devices = await android.listDevices()
    expect(devices[0]).toMatchObject({ id: AVD_DEVICE_ID, running: false })
  })

  it('does not try to switch off a phone that is merely plugged in', async () => {
    const { toolchain: tools, calls } = toolchain({ devices: TWO_DEVICES_OUTPUT })
    const android = new AndroidDeviceManager(tools)
    await android.boot('session-1', PHONE_ID)

    await android.stopDevice(PHONE_ID)

    expect(calls.some((args) => args.join(' ').includes('emu kill'))).toBe(false)
    expect(android.devicesOf('session-1')).toEqual([])
  })
})

/**
 * Everyone watching one device, fed from one decoder state.
 *
 * scrcpy states the stream's parameter sets exactly once per connection, in a config
 * packet at the very start, and the renderer builds its decoder ONLY on a frame
 * marked `codecConfig`. So who gets that packet is not a detail — it is whether a
 * viewer ever draws anything at all.
 */
describe('a second viewer of the same device', () => {
  const AVD_DEVICE_ID = `android:avd:${AVD_ID}`

  function manager() {
    scrcpy.connections.length = 0
    return new AndroidDeviceManager(toolchain({ devices: TWO_DEVICES_OUTPUT }).toolchain)
  }

  /** SPS then PPS, Baseline 4.1, exactly as this repo's AVD sends them. */
  const PARAMETER_SETS = Buffer.from(
    '000000016742c0298d680900a1a420202020f08846a00000000168ce01a835c8',
    'hex',
  )
  const config = {
    kind: 'media' as const,
    config: true,
    keyframe: false,
    timestampUs: 0,
    data: PARAMETER_SETS,
  }

  it('is handed the config packet the first viewer already spent', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)

    const first: DeviceFrame[] = []
    android.subscribe(AVD_DEVICE_ID, (frame) => first.push(frame))
    await vi.waitFor(() => expect(scrcpy.connections).toHaveLength(1))
    scrcpy.connections[0]!.emit(config)
    expect(first[0]).toMatchObject({ codecConfig: true, codec: 'avc1.42c029' })

    // A panel remounting, a quality renegotiate, or a preview opening onto the
    // connection the agent already made. The config packet is long gone.
    const second: DeviceFrame[] = []
    android.subscribe(AVD_DEVICE_ID, (frame) => second.push(frame))
    await vi.waitFor(() => expect(second).toHaveLength(1))
    expect(second[0]).toMatchObject({ codecConfig: true, codec: 'avc1.42c029' })

    // One connection, not two: a second encoder on the guest would cost the device
    // real work and land two sets of touches out of order.
    expect(scrcpy.connections).toHaveLength(1)
  })

  it('asks the device for a keyframe, rather than waiting out the encoder', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    android.subscribe(AVD_DEVICE_ID, () => {})
    await vi.waitFor(() => expect(scrcpy.connections).toHaveLength(1))
    scrcpy.connections[0]!.emit(config)
    // The first viewer arrived with the connection, so it needs nothing asked for.
    expect(scrcpy.connections[0]!.sent).toEqual([])

    android.subscribe(AVD_DEVICE_ID, () => {})
    // RESET_VIDEO. A configured decoder still draws nothing until a keyframe, and the
    // encoder's own were measured more than 12s apart on a real phone.
    await vi.waitFor(() => expect(scrcpy.connections[0]!.sent).toEqual([17]))
  })

  it('leaves the other viewers alone when one goes away', async () => {
    const android = manager()
    await android.boot('session-1', AVD_DEVICE_ID)
    const kept: DeviceFrame[] = []
    const stop = android.subscribe(AVD_DEVICE_ID, () => {})
    android.subscribe(AVD_DEVICE_ID, (frame) => kept.push(frame))
    await vi.waitFor(() => expect(scrcpy.connections).toHaveLength(1))

    stop()
    scrcpy.connections[0]!.emit(config)
    expect(kept).toHaveLength(1)
  })
})
