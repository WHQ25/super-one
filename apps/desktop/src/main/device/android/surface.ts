/**
 * Android as a `DeviceSurface`.
 *
 * Thicker than the iOS adapter because the manager below it is thinner: there is no
 * helper process holding a framebuffer and a HID channel, so screenshots go through
 * `screencap` and input is encoded here and written to a scrcpy control socket.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DeviceFrame,
  DeviceInput,
  DeviceInputResult,
  DeviceState,
} from '@superone/shared/device'
import type { DeviceOrientation } from '@superone/shared/device-agent'
import { captureFileName } from '../capture-path'
import type { DeviceCapture, DeviceSurface } from '../surface'
import type { AndroidDeviceManager } from './android-device-manager'
import { encodeDeviceInput } from './scrcpy-control'

/** `Surface.ROTATION_*`, matching `orientationForRotation`. */
const ROTATION: Record<DeviceOrientation, number> = {
  'portrait': 0,
  'landscape-left': 1,
  'portrait-upside-down': 2,
  'landscape-right': 3,
}

export function createAndroidSurface(
  manager: AndroidDeviceManager,
  captureRoot: string,
): DeviceSurface {
  return {
    provider: 'android',

    devicesOf(sessionId) {
      return manager.devicesOf(sessionId)
    },

    async state(deviceId) {
      return manager.deviceState(deviceId)
    },

    /**
     * Point a session at a device that is already up.
     *
     * iOS can bind a simulator without starting it; Android has no such state — a
     * device is attached or it is not. So this refuses a cold AVD rather than quietly
     * booting one, because starting a device is the user's decision and `boot` is
     * where that decision is recorded.
     */
    async bind(sessionId, deviceId) {
      if (!manager.serialFor(deviceId)) {
        return { ...manager.deviceState(deviceId), phase: 'idle' }
      }
      await manager.boot(sessionId, deviceId)
      return manager.deviceState(deviceId)
    },

    async boot(sessionId, deviceId) {
      await manager.boot(sessionId, deviceId)
      return manager.deviceState(deviceId)
    },

    async detach(deviceId) {
      // Lets go of the device and its stream, and deliberately leaves the device
      // running: someone else may want it, and on Android that may be a phone on
      // somebody's desk.
      manager.release(deviceId)
      return manager.deviceState(deviceId)
    },

    async shutdown(deviceId) {
      await manager.stopDevice(deviceId)
      return manager.deviceState(deviceId)
    },

    async releaseSession(sessionId) {
      manager.releaseSession(sessionId)
    },

    async input(deviceId, input: DeviceInput): Promise<DeviceInputResult> {
      const serial = manager.serialFor(deviceId)
      if (!serial) return { ok: false, error: `${deviceId} is not a running Android device.` }

      // Rotation is a setting, not a control message: scrcpy's ROTATE_DEVICE cycles to
      // the next orientation and cannot be told which one to land on.
      if (input.type === 'rotate') {
        await manager.rotate(deviceId, ROTATION[input.orientation])
        return { ok: true }
      }
      if (input.type === 'keyboard') {
        return { ok: false, error: 'Android has no hardware-keyboard switch.' }
      }

      try {
        const connection = await manager.connection(deviceId)
        const messages = encodeDeviceInput(input, connection.screen)
        if (messages.length === 0) return { ok: false, error: `Unsupported input: ${input.type}` }
        connection.send(messages)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    async screenshot(deviceId): Promise<DeviceCapture> {
      const serial = manager.serialFor(deviceId)
      if (!serial) throw new Error(`${deviceId} is not a running Android device.`)
      const png = await manager.adb.execOut(serial, ['screencap', '-p'])
      const name = manager.descriptorFor(deviceId)?.name ?? 'android'
      const fileName = captureFileName(name, 'png', new Date())
      // Filed under the device rather than the session: a capture is a picture OF a
      // device, and a session may have several open at once.
      const path = join(captureRoot, encodeURIComponent(deviceId), fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, png)
      return { path, fileName, kind: 'screenshot' }
    },

    // Recording is not wired up yet. `adb shell screenrecord` can do it, but it needs
    // its own lifecycle — a device-side process, a 3-minute cap to work around, and a
    // pull when it stops — and none of that is shared with the simulator's path.
    // Declared absent in `DEVICE_CAPABILITIES` so the button is disabled rather than
    // offered and then refused.
    async startRecording(): Promise<DeviceCapture> {
      throw new Error('Screen recording is not available for Android devices yet.')
    },
    async stopRecording(): Promise<DeviceCapture | null> {
      return null
    },
    isRecording() {
      return false
    },

    subscribe(deviceId, listener: (frame: DeviceFrame) => void) {
      return manager.subscribe(deviceId, listener)
    },

    onState(listener: (state: DeviceState) => void) {
      return manager.onState(listener)
    },
  }
}
