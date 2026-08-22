/**
 * One bound, booted, artwork-carrying simulator, for the tests that care about where
 * its picture is drawn rather than about what it says.
 *
 * `DeviceStage` and `DevicePanel` keep their own stubs: they vary the
 * device list and the artwork lookup case by case, which is their whole subject. The
 * surface tests all want the same happy device and differ only in where they put it.
 */

import { vi } from 'vitest'
import type { DeviceDescriptor, DeviceState } from '@superone/shared/device'
import type {
  IosSimulatorChrome,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'

export const IOS_SIMULATOR_SESSION_ID = 'session-1'

export const IOS_SIMULATOR_DEVICE: DeviceDescriptor = {
  id: 'ios:p17-265',
  provider: 'ios-sim',
  platform: 'ios',
  name: 'iPhone 17 Pro',
  kind: 'iphone',
  kindName: 'iPhone',
  kindRank: 0,
  model: 'iPhone 17 Pro',
  platformVersion: 'iOS 26.5',
  versionRank: 26005,
  running: true,
  available: true,
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

export const IOS_SIMULATOR_READY: DeviceState = {
  deviceId: IOS_SIMULATOR_DEVICE.id,
  owner: IOS_SIMULATOR_SESSION_ID,
  device: IOS_SIMULATOR_DEVICE,
  phase: 'ready',
  interactive: true,
  orientation: 'portrait',
  pixelWidth: 1206,
  pixelHeight: 2622,
  ios: {
    previewMode: 'native-h264',
    hardwareKeyboardConnected: true,
    hardwareKeyboardAvailable: true,
  },
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
 * `openDeviceStream` / `closeDeviceStream` are how a rebuilt decoder
 * shows up from the outside: the helper encodes with a one-second keyframe interval,
 * so a stream reopened for cosmetic reasons is up to a second of blank glass.
 */
export function stubIosSimulatorEnvironment() {
  const openDeviceStream = vi.fn()
  const closeDeviceStream = vi.fn()
  // The setup file installs a get-trap Proxy that ignores its target, so stubs
  // have to replace the whole object rather than be assigned onto it.
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: {
      iosSimulatorStatus: vi.fn(async () => IOS_SIMULATOR_STATUS),
      deviceList: vi.fn(async () => [IOS_SIMULATOR_DEVICE]),
      deviceBind: vi.fn(async () => IOS_SIMULATOR_READY),
      iosSimulatorChrome: vi.fn(async () => IOS_SIMULATOR_CHROME),
      deviceInput: vi.fn(async () => ({ ok: true })),
      deviceCaptureState: vi.fn(async () => null),
      onDeviceFrame: vi.fn(() => () => {}),
      onDeviceRotateGesture: vi.fn(() => () => {}),
      onDeviceState: vi.fn(() => () => {}),
      onAnyDeviceState: vi.fn(() => () => {}),
      openDeviceStream,
      closeDeviceStream,
    },
  })
  return { openDeviceStream, closeDeviceStream }
}

export function iosSimulatorRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect
}
