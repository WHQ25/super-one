/**
 * A mirrored iPhone as a `DeviceSurface`.
 *
 * The provider with the least to work with. A simulator has a helper holding a
 * framebuffer and a HID channel; Android has scrcpy's video and control sockets. This
 * has a window belonging to somebody else's app, a screenshot API, and synthetic mouse
 * events — so every capability that cannot be honoured is refused outright rather than
 * approximated. `DEVICE_CAPABILITIES['ios-mirror']` is the same list, stated once for
 * the UI so it disables rather than offers-and-fails.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DeviceFrame,
  DeviceInput,
  DeviceInputResult,
  DeviceState,
  DeviceStreamOptions,
} from '@superone/shared/device'
import { captureFileName } from '../capture-path'
import type { DeviceCapture, DeviceSurface } from '../surface'
import { MIRROR_DEVICE_ID, type MirrorDeviceManager } from './mirror-device-manager'
import {
  dragMirror,
  pressMirrorKey,
  tapMirror,
  typeMirrorText,
} from './mirror-helper'
import { MirrorTouchTrack } from './touch-track'

/**
 * How often the preview re-captures.
 *
 * A ceiling set by the transport, not a preference: each frame is a whole
 * `SCScreenshotManager` round trip plus a PNG encode, so this is nothing like the
 * simulator's or scrcpy's video streams. Raising it burns CPU for a picture that is
 * still not smooth. Replacing the poll with a real `SCStream` is the single biggest
 * improvement available to this provider, and it belongs in the helper.
 */
const FRAME_INTERVAL_MS = 250

/**
 * The mirroring app's own menu shortcuts, which is all the "hardware" there is.
 *
 * Deliberately short. There is no Back button because iOS has none, and no lock or
 * volume keys because the mirroring window does not forward them — offering either
 * would be a control that silently does nothing.
 */
const BUTTON_KEYS: Record<string, string> = {
  home: 'cmd+1',
  'app-switch': 'cmd+2',
}

export function createMirrorSurface(
  manager: MirrorDeviceManager,
  captureRoot: string,
): DeviceSurface {
  /** Accumulates a pointer gesture — see `MirrorTouchTrack` for why it must. */
  const track = new MirrorTouchTrack()

  const refuse = (error: string): DeviceInputResult => ({ ok: false, error })

  return {
    provider: 'ios-mirror',

    state: (deviceId) => manager.deviceState(deviceId),
    bind: (sessionId, deviceId) => manager.bind(sessionId, deviceId),
    boot: (sessionId, deviceId) => manager.boot(sessionId, deviceId),
    detach: (deviceId) => manager.detach(deviceId),

    /**
     * The same as letting go.
     *
     * Quitting iPhone Mirroring is the user's business: they may be using the phone
     * themselves in the window we happen to be reading, and closing a panel is not a
     * reason to sever that. So there is nothing to shut down — only to release.
     */
    shutdown: (deviceId) => manager.detach(deviceId),
    release: async (deviceId) => { await manager.detach(deviceId) },

    async input(deviceId, input): Promise<DeviceInputResult> {
      try {
        switch (input.type) {
          case 'tap': {
            const snapshot = await manager.snapshotForInput()
            await tapMirror(snapshot, input.xRatio * snapshot.width, input.yRatio * snapshot.height)
            return { ok: true }
          }
          case 'touch.update': {
            const gesture = track.absorb(input.contacts)
            if (!gesture) return { ok: true }
            const snapshot = await manager.snapshotForInput()
            const points = gesture.path.map((point) => ({
              x: point.xRatio * snapshot.width,
              y: point.yRatio * snapshot.height,
            }))
            // A gesture that never moved is a tap. Sending it as a two-point drag
            // would make iOS read a zero-length swipe, which some views ignore.
            if (points.length < 2) await tapMirror(snapshot, points[0]!.x, points[0]!.y)
            else await dragMirror(snapshot, points)
            return { ok: true }
          }
          case 'touch.cancel':
            track.reset()
            return { ok: true }
          case 'text': {
            const snapshot = await manager.snapshotForInput()
            await typeMirrorText(snapshot, input.text)
            return { ok: true }
          }
          case 'button': {
            const key = BUTTON_KEYS[input.button]
            if (!key) return refuse(`A mirrored iPhone has no ${input.button} button.`)
            const snapshot = await manager.snapshotForInput()
            await pressMirrorKey(snapshot, key)
            return { ok: true }
          }
          case 'rotate':
            // Not "not yet": a phone turns when its owner turns it, and macOS reshapes
            // the window to follow. There is no request to make.
            return refuse('A mirrored iPhone turns only when you turn the phone.')
          case 'keyboard':
            return refuse('A real iPhone has no simulated hardware keyboard.')
          default:
            return refuse(`Unsupported input for ${deviceId}.`)
        }
      } catch (cause) {
        return refuse(cause instanceof Error ? cause.message : String(cause))
      }
    },

    async screenshot(deviceId): Promise<DeviceCapture> {
      const snapshot = await manager.capture()
      const fileName = captureFileName(deviceId, 'png', new Date())
      const path = join(captureRoot, fileName)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, snapshot.png)
      return { kind: 'screenshot', path, fileName }
    },

    // Nothing behind these. `simctl io recordVideo` records a simulator and
    // `screenrecord` records a phone over adb; a window on this Mac has neither, and a
    // frame-by-frame encoder written here would be a video pipeline in the wrong layer.
    startRecording: async () => { throw new Error('A mirrored iPhone cannot be recorded.') },
    stopRecording: async () => null,
    isRecording: () => false,

    /**
     * Frames by polling, because there is no stream to subscribe to.
     *
     * `options` is ignored rather than honoured: quality and frame rate are fixed by
     * the capture path, which is why `previewQuality` is false for this provider.
     * Errors stop the timer instead of looping — an unplugged phone would otherwise
     * produce four failed captures a second for as long as the panel stays open.
     */
    subscribe(deviceId, listener, _options?: DeviceStreamOptions): () => void {
      let sequence = 0
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const tick = async () => {
        if (stopped) return
        try {
          const snapshot = await manager.capture()
          if (stopped) return
          const frame: DeviceFrame = {
            deviceId,
            sequence: sequence++,
            timestampMs: Date.now(),
            mimeType: 'image/png',
            // Every capture is whole. There is no inter-frame coding to be part of.
            keyframe: true,
            codecConfig: false,
            codedWidth: snapshot.width,
            codedHeight: snapshot.height,
            data: snapshot.png,
          }
          listener(frame)
        } catch {
          stopped = true
          return
        }
        // Scheduled after the work, not alongside it: a fixed interval would stack
        // captures on top of each other the moment one takes longer than the gap.
        timer = setTimeout(() => { void tick() }, FRAME_INTERVAL_MS)
      }

      void tick()
      return () => {
        stopped = true
        if (timer) clearTimeout(timer)
      }
    },

    onState: (listener: (state: DeviceState) => void) => manager.onState(listener),
  }
}

export { MIRROR_DEVICE_ID }
