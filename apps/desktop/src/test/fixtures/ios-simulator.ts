/**
 * One bound, booted, artwork-carrying simulator, for the tests that care about where
 * its picture is drawn rather than about what it says.
 *
 * `IosSimulatorStage` and `IosSimulatorPanel` keep their own stubs: they vary the
 * device list and the artwork lookup case by case, which is their whole subject. The
 * surface tests all want the same happy device and differ only in where they put it.
 */

import { vi } from 'vitest'
import type {
  IosSimulatorChrome,
  IosSimulatorDevice,
  IosSimulatorSessionState,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'

export const IOS_SIMULATOR_SESSION_ID = 'session-1'

export const IOS_SIMULATOR_DEVICE: IosSimulatorDevice = {
  udid: 'p17-265',
  name: 'iPhone 17 Pro',
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
  runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  runtimeName: 'iOS 26.5',
  state: 'Booted',
  booted: true,
  available: true,
  ownedBySuperOne: true,
  boundSessionId: IOS_SIMULATOR_SESSION_ID,
}

export const IOS_SIMULATOR_STATUS: IosSimulatorStatus = {
  supported: true,
  platform: 'darwin',
  developerDirectory: '/Applications/Xcode.app/Contents/Developer',
  xcodeVersion: '26.5',
  xcodeBuild: '17F77',
  simctlPath: '/usr/bin/xcrun',
  previewMode: 'native-h264',
  helper: null,
}

export const IOS_SIMULATOR_READY: IosSimulatorSessionState = {
  sessionId: IOS_SIMULATOR_SESSION_ID,
  device: IOS_SIMULATOR_DEVICE,
  phase: 'ready',
  previewMode: 'native-h264',
  interactive: true,
  orientation: 'portrait',
  hardwareKeyboardConnected: true,
  hardwareKeyboardAvailable: true,
  pixelWidth: 1206,
  pixelHeight: 2622,
}

export const IOS_SIMULATOR_CHROME: IosSimulatorChrome = {
  identifier: 'iPhone17Pro',
  slices: {
    topLeft: 'tl.png', top: 't.png', topRight: 'tr.png', right: 'r.png',
    bottomRight: 'br.png', bottom: 'b.png', bottomLeft: 'bl.png', left: 'l.png',
  },
  corner: 110,
  screenMask: 'data:image/png;base64,AA==',
  width: 438,
  height: 910,
  padding: { top: 0, left: 13, bottom: 0, right: 13 },
  screen: { x: 18, y: 18, width: 402, height: 874 },
  buttons: [],
}

/**
 * Install the environment bridge, and hand back the two calls worth watching.
 *
 * `openIosSimulatorStream` / `closeIosSimulatorStream` are how a rebuilt decoder
 * shows up from the outside: the helper encodes with a one-second keyframe interval,
 * so a stream reopened for cosmetic reasons is up to a second of blank glass.
 */
export function stubIosSimulatorEnvironment() {
  const openIosSimulatorStream = vi.fn()
  const closeIosSimulatorStream = vi.fn()
  // The setup file installs a get-trap Proxy that ignores its target, so stubs
  // have to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorStatus: vi.fn(async () => IOS_SIMULATOR_STATUS),
      iosSimulatorList: vi.fn(async () => [IOS_SIMULATOR_DEVICE]),
      iosSimulatorBind: vi.fn(async () => IOS_SIMULATOR_READY),
      iosSimulatorChrome: vi.fn(async () => IOS_SIMULATOR_CHROME),
      iosSimulatorInput: vi.fn(async () => ({ ok: true })),
      iosSimulatorCaptureState: vi.fn(async () => null),
      onIosSimulatorFrame: vi.fn(() => () => {}),
      onIosSimulatorRotateGesture: vi.fn(() => () => {}),
      onIosSimulatorSessionState: vi.fn(() => () => {}),
      openIosSimulatorStream,
      closeIosSimulatorStream,
    },
  })
  return { openIosSimulatorStream, closeIosSimulatorStream }
}

export function iosSimulatorRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect
}
