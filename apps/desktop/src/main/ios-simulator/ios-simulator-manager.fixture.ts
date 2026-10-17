import { vi } from 'vitest'
import type {
  IosSimulatorDevice,
  IosSimulatorInput,
  IosSimulatorPreviewQuality,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'
import { isIosSimulatorLandscape } from '@superone/shared/ios-simulator'
import type {
  IosSimulatorNativeAttachment,
  IosSimulatorNativeStreamInfo,
  NativeFramePacket,
} from './helper-client'

export const status: IosSimulatorStatus = {
  supported: true,
  platform: 'darwin',
  developerDirectory: '/Applications/Xcode.app/Contents/Developer',
  xcodeVersion: 'Xcode 26.6',
  xcodeBuild: '17F113',
  simctlPath: '/usr/bin/simctl',
  previewMode: 'native-framebuffer',
  helper: null,
}

export function device(overrides: Partial<IosSimulatorDevice> = {}): IosSimulatorDevice {
  return {
    udid: 'device-a',
    name: 'iPhone 17 Pro',
    runtimeIdentifier: 'runtime-ios-26',
    runtimeName: 'iOS 26.0',
    state: 'Shutdown',
    booted: false,
    available: true,
    ownedBySuperOne: false,
    ...overrides,
  }
}

export function setup(initial = device()) {
  let current = initial
  let attachment: IosSimulatorNativeAttachment | null = null
  let frameListener: ((frame: NativeFramePacket) => void) | null = null
  const simctl = {
    status: vi.fn(async () => status),
    listDevices: vi.fn(async () => [current]),
    listRuntimes: vi.fn(async () => []),
    listDeviceTypeBundles: vi.fn(async () => new Map<string, string>()),
    create: vi.fn(async () => current.udid),
    boot: vi.fn(async () => { current = device({ ...current, state: 'Booted', booted: true }) }),
    shutdown: vi.fn(async () => { current = device({ ...current, state: 'Shutdown', booted: false }) }),
    writePasteboard: vi.fn(async () => {}),
  }
  let streamInfo: IosSimulatorNativeStreamInfo | null = null
  let alive = true
  let guestLandscape = false
  let guestFollowsRotation = true
  const native = {
    get attachment() { return attachment },
    get streamInfo() { return streamInfo },
    get alive() { return alive },
    attach: vi.fn(async (udid: string, _screenId?: number) => {
      // A rebuild hands back a fresh process, so attaching revives the fake too.
      alive = true
      attachment = {
        udid, pixelWidth: 1179, pixelHeight: 2556, inputAvailable: true,
        keyboardAvailable: true, accessibilityAvailable: true,
      }
      return attachment
    }),
    // The Duo's panels: cover is screen 1, the inner panel screen 3.
    fold: vi.fn(async (_position: number, _durationMs: number, screenId: number) => {
      attachment = {
        ...attachment!,
        pixelWidth: screenId === 3 ? 2007 : 1398,
        pixelHeight: screenId === 3 ? 2853 : 2034,
      }
      return attachment
    }),
    startFrames: vi.fn(async (
      _preferredMode: 'native-framebuffer' | 'native-h264',
      quality: IosSimulatorPreviewQuality,
      listener: (frame: NativeFramePacket) => void,
    ) => {
      // Mirrors the helper, which rejects `stream.start` while one is open.
      if (frameListener) throw new Error('Frame stream is already running.')
      frameListener = listener
      // Mirrors the helper's own rounding so a scaled stream reports what it encodes.
      const scale = quality.scale
      streamInfo = {
        codec: 'h264' as const,
        pixelWidth: scale >= 1 ? 1179 : Math.round(1179 * scale) & ~1,
        pixelHeight: scale >= 1 ? 2556 : Math.round(2556 * scale) & ~1,
      }
      return streamInfo
    }),
    closeFrames: vi.fn(async () => { frameListener = null; streamInfo = null }),
    input: vi.fn(async (input: IosSimulatorInput) => {
      // The app may follow the device turn or keep its content orientation locked.
      if (input.type === 'rotate' && guestFollowsRotation) {
        guestLandscape = isIosSimulatorLandscape(input.orientation)
      }
      return { ok: true }
    }),
    // Guest POINT space, so the root frame turns with the device -- this is the only
    // reading that says whether the guest acted on the orientation event.
    dumpAccessibility: vi.fn(async () => ({
      generation: 1,
      nodes: 1,
      complete: true,
      tree: {
        uid: 1,
        role: 'application',
        frame: (guestLandscape ? [0, 0, 956, 440] : [0, 0, 440, 956]) as [number, number, number, number],
      },
    })),
    hitTestAccessibility: vi.fn(async () => ({ uid: 1 })),
    performAccessibility: vi.fn(async () => {}),
    dispose: vi.fn(async () => { attachment = null; frameListener = null; streamInfo = null }),
  }
  const nativeFactory = vi.fn(async () => native)
  const stopped: string[] = []
  const capture = {
    screenshot: vi.fn(async () => {}),
    startRecording: vi.fn(async (_udid: string, outputPath: string) => ({
      stop: vi.fn(async () => { stopped.push(outputPath) }),
    })),
  }
  return {
    simctl,
    capture,
    stopped,
    native,
    nativeFactory,
    /** An app that pins itself upright -- the home screen, Spotlight, most modals. */
    lockGuestUpright: () => { guestFollowsRotation = false },
    /** The helper process going away underneath a session that still holds it. */
    crashHelper: () => {
      alive = false
      attachment = null
      frameListener = null
      streamInfo = null
    },
    emitFrame: (frame: NativeFramePacket = {
      kind: 'h264', keyframe: true, timestampUs: 123_000,
      data: Buffer.from([0, 0, 0, 1, 0x65]),
    }) => frameListener?.(frame),
  }
}
