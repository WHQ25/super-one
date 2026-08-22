/**
 * Android as a touch device.
 *
 * Satisfies the same `TouchDeviceBackend` the simulator does, and the layer above
 * cannot tell which it is holding. What differs is entirely below this line, and the
 * biggest difference is how "the screen stopped moving" is answered.
 *
 * iOS samples the accessibility tree and a perceptual hash together every 150ms until
 * both hold still. That is unaffordable here: `uiautomator dump` costs 2.4-2.5s
 * against a booted AVD, so seventeen samples would be forty seconds. Instead
 * `screencap` settles the picture — 170ms per call, and losslessly deterministic, so
 * two identical PNGs are byte-identical and need no tolerance at all — and the tree is
 * read ONCE on the frame that stopped moving.
 *
 * A pleasant consequence: the shared `settle()` is used unchanged. Only the
 * fingerprint differs.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeviceOrientation } from '@superone/shared/device-agent'
import { captureFileName } from '../device/capture-path'
import {
  gestureDurationMs,
  synthesizeDoubleTap,
  synthesizeLongPress,
  synthesizePinch,
  synthesizeSwipe,
  type TouchStep,
} from '../device/gesture-synth'
import { settle } from '../device/settle'
import type { AndroidDeviceManager } from '../device/android/android-device-manager'
import {
  encodeBare,
  encodeCancelTouches,
  encodeKeyPress,
  encodeText,
  encodeTouchStep,
  keycodeForButton,
  SCRCPY_MSG,
} from '../device/android/scrcpy-control'
import { uiautomatorToTree } from '../device/android/uiautomator'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  waitForDeviceDelay,
  type DeviceImage,
  type DeviceObservation,
  type ObserveOptions,
  type PerformContext,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

/** `Surface.ROTATION_*`, the inverse of `orientationForRotation`. */
const ROTATION_FOR_ORIENTATION: Record<DeviceOrientation, number> = {
  'portrait': 0,
  'landscape-left': 1,
  'portrait-upside-down': 2,
  'landscape-right': 3,
}

/**
 * Gap between screencap samples.
 *
 * Small because the sample itself is the expensive part — 170ms per call — so the real
 * cadence is set by adb, not by this.
 */
const SETTLE_INTERVAL_MS = 60

export class AndroidBackend implements TouchDeviceBackend {
  private deviceLabel = 'Android'

  /** Addressed by DEVICE — see `IosSimulatorBackend` for why the session no longer is. */
  constructor(
    private readonly manager: AndroidDeviceManager,
    private readonly deviceId: string,
    private readonly captureRoot: string,
  ) {}

  get label(): string { return this.deviceLabel }

  /** The device this backend drives, or a refusal that says how to get one. */
  private require(): { serial: string; name: string } {
    const device = this.manager.descriptorFor(this.deviceId)
    const serial = device ? this.manager.serialFor(device.id) : null
    if (!device || !serial) {
      throw new DeviceAgentError(
        'NO_DEVICE',
        `${this.deviceId} is no longer running. Call device_list, then device_request_control with an id from it.`,
      )
    }
    this.deviceLabel = device.name
    return { serial, name: device.name }
  }

  private screencap(serial: string, signal?: AbortSignal): Promise<Buffer> {
    return this.manager.adb.execOut(serial, ['screencap', '-p'], signal)
  }

  async observe(options: ObserveOptions = {}): Promise<DeviceObservation> {
    throwIfDeviceOperationAborted(options.signal)
    const { serial } = this.require()

    const sample = async () => {
      throwIfDeviceOperationAborted(options.signal)
      const png = await this.screencap(serial, options.signal)
      return { png, hash: createHash('sha256').update(png).digest('hex') }
    }

    // Settling on pixels alone, and only on pixels. The tree is not sampled here at
    // all — that is the whole point, and the reason a wait_for poll on Android costs
    // what it does rather than ten times more.
    const result = options.immediate
      ? { value: await sample(), settled: false }
      : await settle(sample, ({ hash }) => hash, {
        timeoutMs: options.settleTimeoutMs ?? 2500,
        intervalMs: SETTLE_INTERVAL_MS,
        ...(options.signal ? { signal: options.signal } : {}),
      })

    throwIfDeviceOperationAborted(options.signal)
    const screen = readPngSize(result.value.png)
    const xml = await this.manager.adb
      .execOut(serial, ['uiautomator', 'dump', '/dev/tty'], options.signal)
      .then((buffer) => buffer.toString('utf8'))
      .catch(() => '')
    throwIfDeviceOperationAborted(options.signal)

    const dump = uiautomatorToTree(xml, {
      ...(screen ? { screen } : {}),
      ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}),
    })
    if (!dump) {
      throw new DeviceAgentError(
        'NO_DEVICE',
        'The screen could not be read. `uiautomator dump` returned nothing usable — '
        + 'a device mid-animation or showing a secure window will do this.',
      )
    }

    return {
      root: dump.tree.root,
      orientation: dump.orientation,
      screen: screen ?? dump.screen,
      settled: result.settled,
      frameHash: result.value.hash,
      ...(dump.truncated ? { truncated: true } : {}),
    }
  }

  async capture(): Promise<DeviceImage> {
    const { serial, name } = this.require()
    const png = await this.screencap(serial)
    const path = join(this.captureRoot, this.deviceId, captureFileName(name, 'png', new Date()))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, png)
    const size = readPngSize(png)
    return { path, width: size?.width ?? 0, height: size?.height ?? 0 }
  }

  async perform(action: ResolvedAction, context: PerformContext): Promise<void> {
    const { signal } = context
    throwIfDeviceOperationAborted(signal)

    switch (action.kind) {
      case 'press':
        // `uiautomator dump` is a snapshot with no element table behind it, so there
        // is nothing durable to address. Named rather than reported as an unknown ref:
        // an unknown ref sends the agent re-snapshotting forever, while this sends it
        // to `tap`, which works.
        throw new DeviceAgentError(
          'UNSUPPORTED',
          `${action.ref} cannot be pressed through accessibility on Android. `
          + 'Use tap, which aims at its centre.',
        )
      case 'tap':
        return this.runGesture(
          [{ kind: 'tap', xRatio: action.x, yRatio: action.y, delayMs: 0 }],
          signal,
        )
      case 'doubleTap':
        return this.runGesture(synthesizeDoubleTap(action.x, action.y), signal)
      case 'longPress':
        return this.runGesture(
          synthesizeLongPress(action.x, action.y, action.durationMs),
          signal,
        )
      case 'swipe':
        return this.runGesture(
          synthesizeSwipe(action.fromX, action.fromY, action.toX, action.toY, action.durationMs),
          signal,
        )
      case 'pinch':
        return this.runGesture(
          synthesizePinch(action.x, action.y, action.scale, {
            ...(action.durationMs ? { durationMs: action.durationMs } : {}),
          }),
          signal,
        )
      case 'type': {
        // No pasteboard detour and no character budget: scrcpy's text channel is UTF-8
        // end to end, unlike the simulator's HID channel, which carries usage codes and
        // therefore cannot spell anything outside ASCII.
        const connection = await this.connection()
        connection.send(encodeText(action.text))
        return
      }
      case 'key': {
        const keycode = keycodeForButton(action.button)
        if (keycode === null) {
          throw new DeviceAgentError('UNSUPPORTED', `Android has no ${action.button} button.`)
        }
        const connection = await this.connection()
        connection.send(encodeKeyPress(keycode))
        return
      }
      case 'rotate':
        return this.rotate(action.orientation, signal)
      case 'keyboard':
        // Android's on-screen keyboard follows focus and the current IME; there is no
        // hardware keyboard to unplug the way there is on the simulator.
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'Android has no hardware-keyboard switch. The on-screen keyboard appears when a field takes focus.',
        )
    }
  }

  private connection() {
    return this.manager.connection(this.deviceId).catch((error: unknown) => {
      throw new DeviceAgentError(
        'NO_DEVICE',
        `Could not reach the device to send input: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  /**
   * Turn the device by writing the setting the system reads.
   *
   * Not scrcpy's ROTATE_DEVICE, which cycles to the next orientation rather than
   * taking one — an action asking for `landscape-left` cannot be expressed as "next".
   * Auto-rotation is switched off first, or the accelerometer immediately puts it back.
   */
  private async rotate(orientation: DeviceOrientation, signal?: AbortSignal): Promise<void> {
    const { serial } = this.require()
    const rotation = ROTATION_FOR_ORIENTATION[orientation]
    await this.manager.adb.shell(serial, ['settings', 'put', 'system', 'accelerometer_rotation', '0'], signal)
    await this.manager.adb.shell(serial, ['settings', 'put', 'system', 'user_rotation', String(rotation)], signal)
  }

  /**
   * Play a synthesized gesture in real time.
   *
   * The waits ARE the gesture: Android reads velocity at release to tell a flick from
   * a drag, and reads hold duration to tell a long press from a tap. Sending the series
   * back to back turns every swipe into a teleport.
   */
  private async runGesture(
    steps: readonly TouchStep[],
    signal?: AbortSignal,
  ): Promise<void> {
    const connection = await this.connection()
    // scrcpy rejects positional events whose embedded size differs from the current
    // video stream. The observation comes from a full-size adb screencap, while the
    // connection is capped for preview, so only the connection owns this wire size.
    const screen = { ...connection.screen }
    try {
      for (const step of steps) {
        throwIfDeviceOperationAborted(signal)
        connection.send(encodeTouchStep(step, screen))
        if (step.delayMs > 0) await waitForDeviceDelay(step.delayMs, signal)
      }
    } catch (error) {
      // An interrupted swipe otherwise leaves a finger held down on the guest until
      // something else happens to lift it.
      connection.send(encodeCancelTouches(screen))
      throw error
    }
  }

  /** Wall-clock a gesture will take, so callers can budget a timeout around it. */
  static gestureBudgetMs(steps: readonly TouchStep[]): number {
    return gestureDurationMs(steps)
  }

  /** Collapse the notification shade and friends. Not reachable from `perform` yet. */
  collapsePanels(): Promise<void> {
    return this.connection().then((connection) => {
      connection.send(encodeBare(SCRCPY_MSG.COLLAPSE_PANELS))
    })
  }
}

/**
 * Width and height out of a PNG's IHDR.
 *
 * Read from the bytes rather than asked of the device: `wm size` reports the display,
 * which is not the same number as what `screencap` produced once anything has scaled,
 * and the agent's coordinates are relative to the image it was shown.
 */
export function readPngSize(png: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then a length + "IHDR" + width + height.
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) return null
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}
