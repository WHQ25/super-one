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
  DeviceSessionState,
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
  const serialFor = (sessionId: string): string | null => {
    const device = manager.controlled(sessionId)
    return device ? manager.serialFor(device.id) : null
  }

  return {
    platform: 'android',

    owns(sessionId) {
      return manager.holdsSession(sessionId)
    },

    async sessionState(sessionId) {
      return manager.sessionState(sessionId)
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
        return { ...manager.sessionState(sessionId), phase: 'idle' }
      }
      await manager.boot(sessionId, deviceId)
      return manager.sessionState(sessionId)
    },

    async boot(sessionId, deviceId) {
      await manager.boot(sessionId, deviceId)
      return manager.sessionState(sessionId)
    },

    async detach(sessionId) {
      // Lets go of the device and its stream, and deliberately leaves the device
      // running: someone else may want it, and on Android that may be a phone on
      // somebody's desk.
      manager.release(sessionId)
      return manager.sessionState(sessionId)
    },

    async shutdown(sessionId) {
      await manager.stopDevice(sessionId)
      return manager.sessionState(sessionId)
    },

    async release(sessionId) {
      manager.release(sessionId)
    },

    async input(sessionId, input: DeviceInput): Promise<DeviceInputResult> {
      const serial = serialFor(sessionId)
      if (!serial) return { ok: false, error: 'This session controls no Android device.' }

      // Rotation is a setting, not a control message: scrcpy's ROTATE_DEVICE cycles to
      // the next orientation and cannot be told which one to land on.
      if (input.type === 'rotate') {
        await manager.rotate(sessionId, ROTATION[input.orientation])
        return { ok: true }
      }
      if (input.type === 'keyboard') {
        return { ok: false, error: 'Android has no hardware-keyboard switch.' }
      }

      try {
        const connection = await manager.connection(sessionId)
        const messages = encodeDeviceInput(input, connection.screen)
        if (messages.length === 0) return { ok: false, error: `Unsupported input: ${input.type}` }
        connection.send(messages)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    async screenshot(sessionId): Promise<DeviceCapture> {
      const serial = serialFor(sessionId)
      if (!serial) throw new Error('This session controls no Android device.')
      const png = await manager.adb.execOut(serial, ['screencap', '-p'])
      const name = manager.controlled(sessionId)?.name ?? 'android'
      const fileName = captureFileName(name, 'png', new Date())
      const path = join(captureRoot, sessionId, fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, png)
      return { path, fileName, kind: 'screenshot' }
    },

    // Recording is not wired up yet. `adb shell screenrecord` can do it, but it needs
    // its own lifecycle — a device-side process, a 3-minute cap to work around, and a
    // pull when it stops — and none of that is shared with the simulator's path.
    // Refused by name so the button can be disabled rather than appearing to work.
    async startRecording(): Promise<DeviceCapture> {
      throw new Error('Screen recording is not available for Android devices yet.')
    },
    async stopRecording(): Promise<DeviceCapture | null> {
      return null
    },
    isRecording() {
      return false
    },

    subscribe(sessionId, listener: (frame: DeviceFrame) => void) {
      return manager.subscribe(sessionId, listener)
    },

    onSessionState(listener: (state: DeviceSessionState) => void) {
      return manager.onSessionState(listener)
    },
  }
}
