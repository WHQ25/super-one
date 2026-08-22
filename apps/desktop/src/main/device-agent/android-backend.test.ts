import { describe, expect, it, vi } from 'vitest'
import { Adb, type AdbResult, type RunAdb } from '../device/android/adb'
import { Avd } from '../device/android/avd'
import { AndroidDeviceManager } from '../device/android/android-device-manager'
import type { ScrcpyConnection } from '../device/android/scrcpy-server'
import { MOTION, SCRCPY_MSG } from '../device/android/scrcpy-control'
import { ANDROID_LAUNCHER_DUMP } from '../../test/fixtures/android-uiautomator'
import { AndroidBackend, readPngSize } from './android-backend'
import { DeviceAgentError, type DeviceObservation } from './types'

const AVD_ID = 'Medium_Phone_API_36.1'
const SERIAL = 'emulator-5554'
const DEVICE_ID = `android:avd:${AVD_ID}`

const DEVICES_OUTPUT = `List of devices attached
${SERIAL}          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:2
`

/** A PNG that is nothing but a valid IHDR — all `readPngSize` ever looks at. */
function png(width: number, height: number, filler = 0): Buffer {
  const buffer = Buffer.alloc(64, filler)
  buffer.writeUInt32BE(0x89504e47, 0)
  buffer.writeUInt32BE(0x49484452, 12)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function ok(value: string | Buffer): AdbResult {
  return { stdout: typeof value === 'string' ? Buffer.from(value) : value, stderr: '', code: 0 }
}

interface Harness {
  backend: AndroidBackend
  sent: Buffer[]
  calls: string[][]
  screencaps: () => number
  dumps: () => number
}

/**
 * A backend over a real manager, with adb canned and scrcpy stubbed.
 *
 * `screens` is the sequence of screenshots `screencap` hands back; repeating the last
 * one is what makes the picture settle, and varying them is what keeps it moving.
 */
async function harness(options: { screens?: Buffer[]; dump?: string } = {}): Promise<Harness> {
  const calls: string[][] = []
  const screens = options.screens ?? [png(1080, 2400)]
  let screencaps = 0
  let dumps = 0

  const respond: RunAdb = async (args) => {
    calls.push([...args])
    const joined = args.join(' ')
    if (joined === '-list-avds') return ok(`${AVD_ID}\n`)
    if (joined === 'devices -l') return ok(DEVICES_OUTPUT)
    if (joined.includes('emu avd name')) return ok(`${AVD_ID}\nOK\n`)
    if (joined.includes('ro.build.version.sdk')) return ok('36\n')
    if (joined.includes('sys.boot_completed')) return ok('1\n')
    if (joined.includes('screencap')) {
      const screen = screens[Math.min(screencaps, screens.length - 1)]!
      screencaps += 1
      return ok(screen)
    }
    if (joined.includes('uiautomator')) {
      dumps += 1
      return ok(options.dump ?? ANDROID_LAUNCHER_DUMP)
    }
    return ok('')
  }

  const manager = new AndroidDeviceManager({
    adb: new Adb(respond),
    avd: new Avd('/nonexistent/emulator', respond, '/nonexistent/avd'),
    adbBinary: '/nonexistent/adb',
  })
  await manager.boot('session-1', DEVICE_ID)

  const sent: Buffer[] = []
  const connection = {
    deviceName: 'sdk_gphone64_arm64',
    screen: { width: 1080, height: 2400 },
    onMedia: () => () => {},
    onSession: () => () => {},
    onClosed: () => () => {},
    send: (messages: Buffer | readonly Buffer[]) => {
      sent.push(...(Array.isArray(messages) ? messages : [messages as Buffer]))
    },
    close: async () => {},
  } satisfies ScrcpyConnection
  manager.connection = async () => connection

  return {
    backend: new AndroidBackend(manager, 'session-1', '/tmp/captures'),
    sent,
    calls,
    screencaps: () => screencaps,
    dumps: () => dumps,
  }
}

function observationOf(screen = { width: 1080, height: 2400 }): DeviceObservation {
  return {
    root: { ref: '@e0', role: 'group' },
    orientation: 'portrait',
    screen,
    settled: true,
  }
}

describe('observing a screen', () => {
  it('reads the tree exactly once, however many samples it took to settle', async () => {
    // The whole design. `uiautomator dump` costs 2.4-2.5s against a real AVD, so a
    // settle loop that sampled it the way iOS samples its tree would take forty
    // seconds. Pixels settle; the tree is read on the frame that stopped moving.
    const moving = png(1080, 2400, 1)
    const still = png(1080, 2400, 2)
    const { backend, screencaps, dumps } = await harness({
      screens: [moving, png(1080, 2400, 3), still, still],
    })

    const observation = await backend.observe()

    expect(screencaps()).toBeGreaterThan(2)
    expect(dumps()).toBe(1)
    expect(observation.settled).toBe(true)
  })

  it('settles on bytes, with no tolerance, because the capture is lossless', async () => {
    // iOS compares perceptual hashes within a bit of slack, since its scaler wobbles on
    // boundaries. `screencap` is lossless: an unchanged screen produces a
    // byte-identical PNG, verified on a real device, so equality is the honest test.
    const frame = png(1080, 2400, 7)
    const { backend, screencaps } = await harness({ screens: [frame, frame] })

    const observation = await backend.observe()

    expect(observation.settled).toBe(true)
    expect(screencaps()).toBe(2)
  })

  it('reports an unsettled screen rather than waiting forever on an animation', async () => {
    const forever = Array.from({ length: 40 }, (_, index) => png(1080, 2400, index))
    const { backend } = await harness({ screens: forever })

    const observation = await backend.observe({ settleTimeoutMs: 300 })

    expect(observation.settled).toBe(false)
  })

  it('skips settling entirely when the caller says it already did', async () => {
    const { backend, screencaps } = await harness()
    await backend.observe({ immediate: true })
    expect(screencaps()).toBe(1)
  })

  it('sizes the tree against the screenshot, not against what the display claims', async () => {
    const { backend } = await harness({ screens: [png(1080, 2400, 5), png(1080, 2400, 5)] })
    const observation = await backend.observe()
    expect(observation.screen).toEqual({ width: 1080, height: 2400 })
  })

  it('carries the frame hash, so the layer above can judge whether anything changed', async () => {
    const { backend } = await harness()
    expect((await backend.observe()).frameHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses with a reason when the dump comes back unusable', async () => {
    const { backend } = await harness({ dump: 'ERROR: could not get idle state.' })
    await expect(backend.observe()).rejects.toThrow(/could not be read/)
  })
})

describe('a session holding no device', () => {
  it('says how to get one instead of failing obscurely', async () => {
    const manager = new AndroidDeviceManager({
      adb: new Adb(async () => ok('')),
      avd: new Avd('/x', async () => ok(''), '/x'),
      adbBinary: '/x',
    })
    const backend = new AndroidBackend(manager, 'session-1', '/tmp')
    await expect(backend.observe()).rejects.toThrow(/device_request_control/)
  })
})

describe('performing actions', () => {
  it('sends a tap as a down and an up, since Android has no atomic tap', async () => {
    const { backend, sent } = await harness()
    await backend.perform({ kind: 'tap', x: 0.5, y: 0.5 }, { observation: observationOf() })

    expect(sent).toHaveLength(2)
    expect(sent.map((message) => message.readUInt8(1))).toEqual([MOTION.DOWN, MOTION.UP])
  })

  it('aims at the screen the observation was taken against', async () => {
    // Not at whatever the device reports now. A rotation between snapshot and action
    // changes the framebuffer shape on Android, and the ratios the agent quoted belong
    // to the picture it was shown.
    const { backend, sent } = await harness()
    await backend.perform(
      { kind: 'tap', x: 1, y: 1 },
      { observation: observationOf({ width: 800, height: 360 }) },
    )
    expect([sent[0]!.readUInt16BE(18), sent[0]!.readUInt16BE(20)]).toEqual([800, 360])
  })

  it('plays a swipe as a timed series rather than a teleport', async () => {
    const { backend, sent } = await harness()
    await backend.perform(
      { kind: 'swipe', fromX: 0.5, fromY: 0.8, toX: 0.5, toY: 0.2, durationMs: 100 },
      { observation: observationOf() },
    )
    expect(sent.length).toBeGreaterThan(4)
    expect(sent[0]!.readUInt8(1)).toBe(MOTION.DOWN)
    expect(sent.at(-1)!.readUInt8(1)).toBe(MOTION.UP)
  })

  it('moves two fingers for a pinch', async () => {
    const { backend, sent } = await harness()
    await backend.perform(
      { kind: 'pinch', x: 0.5, y: 0.5, scale: 2, durationMs: 50 },
      { observation: observationOf() },
    )
    const pointers = new Set(sent.map((message) => message.readBigInt64BE(2)))
    expect(pointers).toEqual(new Set([1n, 2n]))
  })

  it('types UTF-8 straight through, with no pasteboard detour', async () => {
    const { backend, sent } = await harness()
    await backend.perform({ kind: 'type', text: '中文 🎉' }, { observation: observationOf() })

    expect(sent[0]!.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_TEXT)
    expect(sent[0]!.subarray(5).toString('utf8')).toBe('中文 🎉')
  })

  it('presses the Android back button, which iOS does not have', async () => {
    const { backend, sent } = await harness()
    await backend.perform({ kind: 'key', button: 'back' }, { observation: observationOf() })

    expect(sent).toHaveLength(2)
    expect(sent[0]!.readInt32BE(2)).toBe(4)
    expect(sent.map((message) => message.readUInt8(1))).toEqual([0, 1])
  })

  it('turns the device by writing the setting, not by cycling', async () => {
    // scrcpy's ROTATE_DEVICE advances to the next orientation, which cannot express
    // "make it landscape-left" — and auto-rotation has to go off first or the
    // accelerometer immediately puts it back.
    const { backend, calls } = await harness()
    await backend.perform(
      { kind: 'rotate', orientation: 'landscape-left' },
      { observation: observationOf() },
    )
    const shell = calls.map((call) => call.join(' '))
    expect(shell.some((call) => call.includes('accelerometer_rotation 0'))).toBe(true)
    expect(shell.some((call) => call.includes('user_rotation 1'))).toBe(true)
  })
})

describe('capabilities Android does not have', () => {
  it('refuses press-by-ref by name, so the agent switches to tap', async () => {
    // Reporting it as an unknown ref would send the agent re-snapshotting forever;
    // naming the limitation sends it to `tap`, which works.
    const { backend } = await harness()
    const failure = await backend
      .perform({ kind: 'press', ref: '@e12' }, { observation: observationOf() })
      .catch((error: unknown) => error as DeviceAgentError)

    expect(failure).toBeInstanceOf(DeviceAgentError)
    expect((failure as DeviceAgentError).code).toBe('UNSUPPORTED')
    expect((failure as Error).message).toMatch(/tap/)
  })

  it('refuses the hardware-keyboard switch, which has no Android counterpart', async () => {
    const { backend } = await harness()
    await expect(backend.perform(
      { kind: 'keyboard', connected: false },
      { observation: observationOf() },
    )).rejects.toThrow(/on-screen keyboard appears when a field takes focus/)
  })
})

describe('cancellation', () => {
  it('lifts every finger when a gesture is interrupted', async () => {
    // An abandoned swipe otherwise leaves a contact held down on the guest until
    // something else happens to lift it.
    const { backend, sent } = await harness()
    const controller = new AbortController()
    const flight = backend.perform(
      { kind: 'swipe', fromX: 0.1, fromY: 0.9, toX: 0.9, toY: 0.1, durationMs: 2000 },
      { observation: observationOf(), signal: controller.signal },
    )
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))
    controller.abort()

    await expect(flight).rejects.toThrow()
    expect(sent.some((message) => message.readUInt8(1) === MOTION.CANCEL)).toBe(true)
  })
})

describe('readPngSize', () => {
  it('reads the dimensions out of the IHDR', () => {
    expect(readPngSize(png(1080, 2400))).toEqual({ width: 1080, height: 2400 })
  })

  it('declines anything that is not a PNG', () => {
    expect(readPngSize(Buffer.alloc(40))).toBeNull()
    expect(readPngSize(Buffer.from('not a png'))).toBeNull()
  })
})
