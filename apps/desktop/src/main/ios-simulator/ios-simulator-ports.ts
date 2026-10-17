import type {
  IosSimulatorChrome,
  IosSimulatorCreateRequest,
  IosSimulatorDevice,
  IosSimulatorHelperProbe,
  IosSimulatorInput,
  IosSimulatorInputResult,
  IosSimulatorPreviewQuality,
  IosSimulatorRuntimeOption,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'
import type { IosSimulatorAccessibilityDump, IosSimulatorRawNode } from './a11y-tree'
import type {
  IosSimulatorNativeAttachment,
  IosSimulatorNativeStreamInfo,
  IosSimulatorFrameHash,
  IosSimulatorFrameOcr,
  IosSimulatorFrameOcrOptions,
  NativeFramePacket,
} from './helper-client'
import type { IosSimulatorCapturePort } from './capture'
import type { IosSimulatorFoldLayout } from './device-chrome'

export interface IosSimulatorPort {
  status(): Promise<Omit<IosSimulatorStatus, 'helper' | 'previewMode'>>
  listDevices(): Promise<IosSimulatorDevice[]>
  listRuntimes(): Promise<IosSimulatorRuntimeOption[]>
  listDeviceTypeBundles(): Promise<Map<string, string>>
  create(request: IosSimulatorCreateRequest): Promise<string>
  boot(udid: string): Promise<void>
  shutdown(udid: string): Promise<void>
  writePasteboard(udid: string, text: string): Promise<void>
}

export interface IosSimulatorNativePort {
  attachment: IosSimulatorNativeAttachment | null
  /** The size the helper negotiated, which a scaled preview shrinks below attachment. */
  streamInfo: IosSimulatorNativeStreamInfo | null
  /** False once the helper process died, so a cached session has to be rebuilt. */
  alive: boolean
  /** `screenId` names the screen to show; omitted, the helper shows the largest. */
  attach(udid: string, screenId?: number): Promise<IosSimulatorNativeAttachment>
  /**
   * Sweep a foldable's hinge to `position` (0 closed ... 1 open) and show `screenId`;
   * `tent` then stands it as a tent. The frame stream keeps its old display; the
   * caller restarts it.
   */
  fold(position: number, durationMs: number, screenId: number, tent?: boolean): Promise<IosSimulatorNativeAttachment>
  startFrames(
    preferredMode: 'native-framebuffer' | 'native-h264',
    quality: IosSimulatorPreviewQuality,
    listener: (frame: NativeFramePacket) => void,
  ): Promise<IosSimulatorNativeStreamInfo>
  closeFrames(): Promise<void>
  input(input: IosSimulatorInput): Promise<IosSimulatorInputResult>
  dumpAccessibility(options?: { maxDepth?: number; maxNodes?: number })
    : Promise<IosSimulatorAccessibilityDump>
  hitTestAccessibility(x: number, y: number): Promise<IosSimulatorRawNode>
  frameHash(): Promise<IosSimulatorFrameHash>
  frameOcr(options: IosSimulatorFrameOcrOptions): Promise<IosSimulatorFrameOcr>
  performAccessibility(action: string, generation: number, uid: number): Promise<void>
  dispose(): Promise<void>
}

/** Loads Apple's own device artwork from the local Xcode install. */
export interface IosSimulatorChromePort {
  load(
    deviceTypeIdentifier: string,
    bundlePath: string,
    xcodeVersion: string | null,
    screenId?: number | null,
  ): Promise<IosSimulatorChrome | null>
  /** A foldable's two panels; null for a single-screen device. */
  foldLayout?(deviceTypeIdentifier: string, bundlePath: string): Promise<IosSimulatorFoldLayout | null>
}

export interface IosSimulatorManagerOptions {
  simctl?: IosSimulatorPort
  chrome?: IosSimulatorChromePort
  capture?: IosSimulatorCapturePort
  /** Screenshots and recordings land in `<captureRoot>/<udid>/`. */
  captureRoot?: string
  helperProbe: () => Promise<IosSimulatorHelperProbe | null>
  nativeFactory: () => Promise<IosSimulatorNativePort>
  attachAttempts?: number
  attachRetryMs?: number
  /**
   * A preview that fails to start leaves the panel on its spinner with nothing else
   * to show, so the reason has to leave this class somehow.
   */
  onStreamError?: (udid: string, error: unknown) => void
  /**
   * Suppresses Apple's Simulator.app for as long as this app holds a device it booted
   * itself, returning the stop. See `external-simulator.ts` — a running Simulator.app
   * opens a window for anything that boots, and `flutter run` / `expo run:ios` /
   * Xcode launch it again mid-session, so one hide at boot time is not enough.
   */
  watchExternalSimulator?: () => () => void
  /** How long to keep re-offering text to a guest that has not settled its focus yet. */
  focusConfirmMs?: number
  focusPollMs?: number
}
