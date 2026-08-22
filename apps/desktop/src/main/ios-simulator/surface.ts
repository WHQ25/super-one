/**
 * The iOS Simulator as a `DeviceSurface`.
 *
 * A thin adapter, and thin on purpose: the manager already speaks nearly this
 * vocabulary, so what is left is translating its two iOS-shaped types — the session
 * state and the device — into the neutral ones. Frames need no translation at all,
 * because `DeviceFrame` was defined from the shape this helper already produced.
 */

import type {
  DeviceFrame,
  DeviceInput,
  DeviceInputResult,
  DeviceSessionState,
  DeviceStreamOptions,
} from '@superone/shared/device'
import type {
  IosSimulatorInput,
  IosSimulatorPreviewMode,
  IosSimulatorSessionState,
} from '@superone/shared/ios-simulator'
import type { DeviceOrientation } from '@superone/shared/device-agent'
import type { DeviceCapture, DeviceSurface } from '../device/surface'
import { toDeviceDescriptor } from './device-port'
import type { IosSimulatorManager } from './ios-simulator-manager'

function toSessionState(state: IosSimulatorSessionState): DeviceSessionState {
  return {
    sessionId: state.sessionId,
    device: state.device ? toDeviceDescriptor(state.device) : null,
    phase: state.phase,
    interactive: state.interactive,
    orientation: state.orientation as DeviceOrientation,
    ...(state.pixelWidth ? { pixelWidth: state.pixelWidth } : {}),
    ...(state.pixelHeight ? { pixelHeight: state.pixelHeight } : {}),
    // The switch and the preview mode are real here and meaningless on Android, so
    // they ride in the platform block rather than being flattened into the shared
    // shape where every reader would have to work out whether they apply.
    ios: {
      previewMode: state.previewMode,
      hardwareKeyboardConnected: state.hardwareKeyboardConnected,
      hardwareKeyboardAvailable: state.hardwareKeyboardAvailable,
    },
  }
}

/** `ios:UDID` back to the udid the manager addresses. Tolerates a bare one. */
function udidOf(deviceId: string): string {
  return deviceId.startsWith('ios:') ? deviceId.slice('ios:'.length) : deviceId
}

export function createIosSimulatorSurface(manager: IosSimulatorManager): DeviceSurface {
  return {
    platform: 'ios',

    async sessionState(sessionId) {
      return toSessionState(await manager.getSessionState(sessionId))
    },
    async bind(sessionId, deviceId) {
      return toSessionState(await manager.bind(sessionId, udidOf(deviceId)))
    },
    async boot(sessionId, deviceId) {
      return toSessionState(await manager.boot(sessionId, udidOf(deviceId)))
    },
    async detach(sessionId) {
      return toSessionState(await manager.detach(sessionId))
    },
    async shutdown(sessionId) {
      return toSessionState(await manager.shutdown(sessionId))
    },
    release(sessionId) {
      return manager.releaseSession(sessionId)
    },

    async input(sessionId, input): Promise<DeviceInputResult> {
      // Structurally identical: `DeviceInput` is this vocabulary with the platform
      // name taken off, and the one member Android lacks (`keyboard`) is the one iOS
      // is the reason for.
      return manager.input(sessionId, input as IosSimulatorInput)
    },
    async screenshot(sessionId): Promise<DeviceCapture> {
      const capture = await manager.screenshot(sessionId)
      return { path: capture.path, fileName: capture.fileName, kind: 'screenshot' }
    },
    async startRecording(sessionId): Promise<DeviceCapture> {
      const capture = await manager.startRecording(sessionId)
      return { path: capture.path, fileName: capture.fileName, kind: 'recording' }
    },
    async stopRecording(sessionId): Promise<DeviceCapture | null> {
      const capture = await manager.stopRecording(sessionId)
      return capture ? { path: capture.path, fileName: capture.fileName, kind: 'recording' } : null
    },
    isRecording(sessionId) {
      return manager.isRecording(sessionId)
    },

    subscribe(sessionId, listener, options?: DeviceStreamOptions) {
      // Both settle in `stream.start`, so they have to travel WITH the subscription
      // rather than be applied to a stream that is already running.
      return manager.subscribe(
        sessionId,
        (frame) => listener(frame as DeviceFrame),
        options?.mode as IosSimulatorPreviewMode | undefined,
        options?.quality,
      )
    },
    onSessionState(listener) {
      return manager.onSessionState((state) => listener(toSessionState(state)))
    },
  }
}
