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
import { formatDeviceId, parseDeviceId } from '@superone/shared/device'
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

/**
 * `ios-sim:UDID` back to the udid the manager addresses. Tolerates a bare one.
 *
 * The whole translation this adapter performs: above it everything is a deviceId,
 * below it CoreSimulator has only ever known udids.
 */
function udidOf(deviceId: string): string {
  return parseDeviceId(deviceId)?.native ?? deviceId
}

export function createIosSimulatorSurface(manager: IosSimulatorManager): DeviceSurface {
  return {
    provider: 'ios-sim',

    devicesOf(sessionId) {
      return manager.devicesOf(sessionId).map((udid) => formatDeviceId('ios-sim', udid))
    },

    async state(deviceId) {
      return toSessionState(await manager.getSessionState(udidOf(deviceId)))
    },
    async bind(sessionId, deviceId) {
      return toSessionState(await manager.bind(sessionId, udidOf(deviceId)))
    },
    async boot(sessionId, deviceId) {
      return toSessionState(await manager.boot(sessionId, udidOf(deviceId)))
    },
    async detach(deviceId) {
      return toSessionState(await manager.detach(udidOf(deviceId)))
    },
    async shutdown(deviceId) {
      return toSessionState(await manager.shutdown(udidOf(deviceId)))
    },
    async releaseSession(sessionId) {
      await manager.releaseSession(sessionId)
    },

    async input(deviceId, input: DeviceInput): Promise<DeviceInputResult> {
      return manager.input(udidOf(deviceId), input as IosSimulatorInput)
    },
    // `kind` is the only field that differs: the simulator distinguishes video kinds
    // the panel has no use for, so each is stated rather than spread through.
    async screenshot(deviceId): Promise<DeviceCapture> {
      const capture = await manager.screenshot(udidOf(deviceId))
      return { path: capture.path, fileName: capture.fileName, kind: 'screenshot' }
    },
    async startRecording(deviceId): Promise<DeviceCapture> {
      const capture = await manager.startRecording(udidOf(deviceId))
      return { path: capture.path, fileName: capture.fileName, kind: 'recording' }
    },
    async stopRecording(deviceId): Promise<DeviceCapture | null> {
      const capture = await manager.stopRecording(udidOf(deviceId))
      return capture ? { path: capture.path, fileName: capture.fileName, kind: 'recording' } : null
    },
    isRecording(deviceId) {
      return manager.isRecording(udidOf(deviceId))
    },

    subscribe(deviceId, listener: (frame: DeviceFrame) => void, options?: DeviceStreamOptions) {
      return manager.subscribe(
        udidOf(deviceId),
        (frame) => listener(frame as unknown as DeviceFrame),
        options?.mode as IosSimulatorPreviewMode | undefined,
        options?.quality,
      )
    },

    onState(listener: (state: DeviceSessionState) => void) {
      return manager.onSessionState((state) => listener(toSessionState(state)))
    },
  }
}
