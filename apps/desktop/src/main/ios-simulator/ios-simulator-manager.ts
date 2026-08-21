import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  IosSimulatorCapture,
  IosSimulatorCaptureKind,
  IosSimulatorChrome,
  IosSimulatorCreateRequest,
  IosSimulatorDevice,
  IosSimulatorFrame,
  IosSimulatorHelperProbe,
  IosSimulatorInput,
  IosSimulatorInputResult,
  IosSimulatorOrientation,
  IosSimulatorPreviewQuality,
  IosSimulatorRuntimeOption,
  IosSimulatorSessionState,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'
import {
  canTypeIosSimulatorText,
  DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY,
  isIosSimulatorLandscape,
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
import {
  captureFileName,
  SimctlCapture,
  type IosSimulatorCapturePort,
  type IosSimulatorRecording,
} from './capture'
import { SimctlClient } from './simctl'
import log from '../logger'

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
  attach(udid: string): Promise<IosSimulatorNativeAttachment>
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
  load(deviceTypeIdentifier: string, bundlePath: string): Promise<IosSimulatorChrome | null>
}

interface ManagerOptions {
  simctl?: IosSimulatorPort
  chrome?: IosSimulatorChromePort
  capture?: IosSimulatorCapturePort
  /** Screenshots and recordings land in `<captureRoot>/<sessionId>/`. */
  captureRoot?: string
  helperProbe: () => Promise<IosSimulatorHelperProbe | null>
  nativeFactory: () => Promise<IosSimulatorNativePort>
  attachAttempts?: number
  attachRetryMs?: number
  /**
   * A preview that fails to start leaves the panel on its spinner with nothing else
   * to show, so the reason has to leave this class somehow.
   */
  onStreamError?: (sessionId: string, error: unknown) => void
  /** How long to wait for the guest to actually turn before calling it a refusal. */
  rotationConfirmMs?: number
  rotationPollMs?: number
}

interface NativeSession {
  udid: string
  client: IosSimulatorNativePort
}

interface RecordingSession {
  /**
   * The start is held as a promise, not a handle: a stop that lands before simctl
   * has announced itself still has to wait for the child so it can signal it.
   */
  flight: Promise<IosSimulatorRecording>
  capture: IosSimulatorCapture
}

interface PreviewStream {
  listeners: Set<(frame: IosSimulatorFrame) => void>
  sequence: number
  started: boolean
  preferredMode: 'native-framebuffer' | 'native-h264'
  activeMode: 'native-framebuffer' | 'native-h264'
  quality: IosSimulatorPreviewQuality
  /**
   * The H.264 config frame, kept so a listener that joins a running stream can be
   * handed one. Both the helper and the encoder send it exactly once, and a decoder
   * that never receives it is never configured — it just stays black.
   */
  lastConfigFrame: IosSimulatorFrame | null
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export class IosSimulatorManager {
  private readonly simctl: IosSimulatorPort
  private readonly capture: IosSimulatorCapturePort
  private readonly captureRoot: string
  private readonly chromeLoader: IosSimulatorChromePort | null
  private readonly helperProbe: () => Promise<IosSimulatorHelperProbe | null>
  private readonly nativeFactory: () => Promise<IosSimulatorNativePort>
  private readonly attachAttempts: number
  private readonly attachRetryMs: number
  private readonly sessionBindings = new Map<string, string>()
  private readonly deviceOwners = new Map<string, string>()
  private readonly superOneBooted = new Set<string>()
  // Keyed by device, not session: the guest keeps its orientation across a detach,
  // a rebind, or a panel remount, and only a shutdown puts it back to portrait.
  private readonly orientations = new Map<string, IosSimulatorOrientation>()
  // Same reasoning, same lifetime: the guest keeps a keyboard plugged or unplugged
  // until something tells it otherwise, and the helper plugs one in on every attach.
  private readonly hardwareKeyboards = new Map<string, boolean>()
  private readonly nativeSessions = new Map<string, NativeSession>()
  private readonly nativeFlights = new Map<string, Promise<NativeSession>>()
  private readonly streams = new Map<string, PreviewStream>()
  // Start and stop must not interleave: both end up calling into one helper that
  // rejects a second `stream.start`, and a late stop would close the stream its
  // successor just opened.
  private readonly streamFlights = new Map<string, Promise<void>>()
  private readonly recordings = new Map<string, RecordingSession>()
  private readonly onStreamError: (sessionId: string, error: unknown) => void
  private readonly rotationConfirmMs: number
  private readonly rotationPollMs: number
  // Host-owned state changes reach the renderer through here. Without it a rotation
  // the agent asked for never left the main process, so the panel kept drawing the
  // device upright around a guest that had turned.
  private readonly stateListeners = new Set<(state: IosSimulatorSessionState) => void>()
  private statusFlight: Promise<IosSimulatorStatus> | null = null

  constructor(options: ManagerOptions) {
    this.simctl = options.simctl ?? new SimctlClient()
    this.capture = options.capture ?? new SimctlCapture()
    this.captureRoot = options.captureRoot ?? join(tmpdir(), 'super-one-ios-simulator-captures')
    this.chromeLoader = options.chrome ?? null
    this.helperProbe = options.helperProbe
    this.nativeFactory = options.nativeFactory
    this.attachAttempts = options.attachAttempts ?? 20
    this.attachRetryMs = options.attachRetryMs ?? 250
    this.onStreamError = options.onStreamError ?? (() => undefined)
    this.rotationConfirmMs = options.rotationConfirmMs ?? 1_500
    this.rotationPollMs = options.rotationPollMs ?? 100
  }

  /**
   * Watch host-owned session state — the two readings CoreSimulator has no getter
   * for, orientation and hardware keyboard, which only this process knows.
   *
   * Everything else the panel shows is pulled on demand, but these change under the
   * renderer's feet whenever an agent drives the device, and a panel that missed the
   * change draws the shell at the wrong angle and maps the user's next touch with it.
   */
  onSessionState(listener: (state: IosSimulatorSessionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => { this.stateListeners.delete(listener) }
  }

  status(force = false): Promise<IosSimulatorStatus> {
    if (!this.statusFlight || force) {
      this.statusFlight = Promise.all([
        this.simctl.status(),
        this.helperProbe().catch((error): IosSimulatorHelperProbe => ({
          protocolVersion: 0,
          developerDirectory: '',
          simulatorKitPath: null,
          capabilities: {
            coreSimulator: false,
            framebuffer: false,
            hid: false,
            rotation: false,
            accessibility: false,
            videoEncoder: false,
          },
          missingSymbols: [],
          error: error instanceof Error ? error.message : String(error),
        })),
      ]).then(([base, helper]) => ({
        ...base,
        previewMode: helper?.capabilities.videoEncoder
          ? 'native-h264' as const
          : 'native-framebuffer' as const,
        helper,
      }))
    }
    return this.statusFlight
  }

  async listDevices(): Promise<IosSimulatorDevice[]> {
    const devices = await this.simctl.listDevices()
    return devices.map((device) => ({
      ...device,
      ownedBySuperOne: this.superOneBooted.has(device.udid),
      ...(this.deviceOwners.get(device.udid)
        ? { boundSessionId: this.deviceOwners.get(device.udid)! }
        : {}),
    }))
  }

  listRuntimes(): Promise<IosSimulatorRuntimeOption[]> {
    return this.simctl.listRuntimes()
  }

  /**
   * Apple's artwork for a specific simulator, or null when Xcode does not ship
   * any — the panel then falls back to its CSS shell.
   */
  async chrome(udid: string): Promise<IosSimulatorChrome | null> {
    if (!this.chromeLoader) return null
    const device = (await this.simctl.listDevices()).find((entry) => entry.udid === udid)
    if (!device?.deviceTypeIdentifier) return null
    const bundlePath = (await this.simctl.listDeviceTypeBundles()).get(device.deviceTypeIdentifier)
    if (!bundlePath) return null
    return this.chromeLoader.load(device.deviceTypeIdentifier, bundlePath)
  }

  async createDevice(request: IosSimulatorCreateRequest): Promise<IosSimulatorDevice> {
    const udid = await this.simctl.create(request)
    // Read the row back rather than synthesising one: simctl fills in the runtime
    // name, availability, and state that the launcher renders.
    const created = (await this.listDevices()).find((device) => device.udid === udid)
    if (!created) throw new Error(`Simulator ${udid} was created but is not listed.`)
    return created
  }

  async bind(sessionId: string, udid: string): Promise<IosSimulatorSessionState> {
    const owner = this.deviceOwners.get(udid)
    if (owner && owner !== sessionId) {
      throw new Error(`Simulator ${udid} is already bound to session ${owner}.`)
    }
    const device = (await this.listDevices()).find((candidate) => candidate.udid === udid)
    if (!device) throw new Error(`Simulator ${udid} was not found.`)
    if (!device.available) throw new Error(device.availabilityError ?? `Simulator ${udid} is unavailable.`)

    const previous = this.sessionBindings.get(sessionId)
    if (previous && previous !== udid) {
      this.deviceOwners.delete(previous)
      await this.teardownSession(sessionId)
    }
    this.sessionBindings.set(sessionId, udid)
    this.deviceOwners.set(udid, sessionId)
    if (device.booted) await this.ensureNativeSession(sessionId, udid)
    return this.getSessionState(sessionId)
  }

  async boot(sessionId: string, udid: string): Promise<IosSimulatorSessionState> {
    const before = (await this.listDevices()).find((candidate) => candidate.udid === udid)
    if (!before) throw new Error(`Simulator ${udid} was not found.`)
    await this.bind(sessionId, udid)
    if (!before.booted) {
      await this.simctl.boot(udid)
      this.superOneBooted.add(udid)
      await this.ensureNativeSession(sessionId, udid)
    }
    return this.getSessionState(sessionId)
  }

  /**
   * Closes the preview and gives the simulator up without stopping it. Ownership is
   * dropped too, so neither closing the panel nor quitting the app takes it down
   * later — it becomes an ordinary running simulator the launcher can attach to.
   */
  async detach(sessionId: string): Promise<IosSimulatorSessionState> {
    const udid = this.sessionBindings.get(sessionId)
    await this.teardownSession(sessionId)
    this.unbind(sessionId, udid)
    if (udid) this.superOneBooted.delete(udid)
    return this.emptyState(sessionId)
  }

  /** Shuts the device down for real, whoever booted it, and unbinds the session. */
  async shutdown(sessionId: string): Promise<IosSimulatorSessionState> {
    const udid = this.sessionBindings.get(sessionId)
    if (!udid) return this.emptyState(sessionId)
    await this.teardownSession(sessionId)
    await this.simctl.shutdown(udid)
    this.superOneBooted.delete(udid)
    this.orientations.delete(udid)
    this.hardwareKeyboards.delete(udid)
    this.unbind(sessionId, udid)
    return this.emptyState(sessionId)
  }

  async releaseSession(sessionId: string): Promise<void> {
    const udid = this.sessionBindings.get(sessionId)
    await this.teardownSession(sessionId)
    this.unbind(sessionId, udid)
    // Closing the panel puts the simulator back the way it was found: shut down
    // what we booted, leave an externally booted simulator running.
    if (udid && this.superOneBooted.has(udid)) {
      this.superOneBooted.delete(udid)
      this.orientations.delete(udid)
      this.hardwareKeyboards.delete(udid)
      await this.simctl.shutdown(udid)
    }
  }

  async getSessionState(sessionId: string): Promise<IosSimulatorSessionState> {
    const udid = this.sessionBindings.get(sessionId)
    if (!udid) return this.emptyState(sessionId)
    const device = (await this.listDevices()).find((candidate) => candidate.udid === udid) ?? null
    const attachment = this.nativeSessions.get(sessionId)?.client.attachment
    return {
      sessionId,
      device,
      phase: device?.booted ? 'ready' : 'idle',
      previewMode: this.streams.get(sessionId)?.activeMode ?? 'native-h264',
      interactive: device?.booted === true && attachment?.inputAvailable === true,
      orientation: this.orientations.get(udid) ?? 'portrait',
      // The helper connects one on every attach, so an attachment with no entry of
      // its own has a keyboard plugged in.
      hardwareKeyboardConnected: this.hardwareKeyboards.get(udid) ?? true,
      hardwareKeyboardAvailable: attachment?.keyboardAvailable === true,
      ...(attachment
        ? { pixelWidth: attachment.pixelWidth, pixelHeight: attachment.pixelHeight }
        : {}),
      ...(!device?.booted ? { message: 'Boot the selected simulator to start the preview.' } : {}),
      ...(device?.booted && attachment?.inputError ? { message: attachment.inputError } : {}),
    }
  }

  async input(sessionId: string, input: IosSimulatorInput): Promise<IosSimulatorInputResult> {
    const udid = this.sessionBindings.get(sessionId)
    if (!udid) return { ok: false, error: 'No simulator is bound to this session.' }
    try {
      const native = await this.ensureNativeSession(sessionId, udid)
      // Anything the simulated keyboard cannot spell — Chinese, emoji, or simply a
      // long block — goes onto the device pasteboard and comes back as Command-V.
      // Sending it as keystrokes would silently drop every non-ASCII character.
      if (input.type === 'text' && !canTypeIosSimulatorText(input.text)) {
        await this.simctl.writePasteboard(udid, input.text)
        return native.client.input({ type: 'paste' })
      }
      const result = await native.client.input(input)
      if (input.type === 'rotate') return this.settleRotation(sessionId, udid, input.orientation, result)
      if (input.type === 'keyboard' && result.ok) {
        this.hardwareKeyboards.set(udid, input.connected)
        await this.publishSessionState(sessionId)
      }
      return result
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Turn a delivered rotation into a reading of the guest.
   *
   * The send succeeding means the orientation event reached the guest workspace, not
   * that anything acted on it: SpringBoard on iPhone, Spotlight, and any app that
   * pins itself upright ignore it silently. Trusting the send is what let `device_act`
   * report a rotation that never happened, and what let the panel draw a landscape
   * shell around a device still standing up.
   */
  private async settleRotation(
    sessionId: string,
    udid: string,
    orientation: IosSimulatorOrientation,
    result: IosSimulatorInputResult,
  ): Promise<IosSimulatorInputResult> {
    const previous = this.orientations.get(udid) ?? 'portrait'
    const turned = result.ok && await this.confirmRotation(sessionId, orientation, previous)
    if (turned) this.orientations.set(udid, orientation)
    // Published on refusal too: the panel turns its shell the moment the user clicks
    // the button, so something has to be able to turn it back. Awaited rather than
    // fired off, so a caller that reads the state back cannot beat its own event.
    await this.publishSessionState(sessionId)
    if (!result.ok || turned) return result
    return {
      ok: false,
      error: 'The rotation reached the guest but the foreground app kept its own '
        + 'orientation. Apps that lock themselves upright — the home screen, Spotlight '
        + '— never turn; try one that supports both, such as Safari.',
    }
  }

  /**
   * Ask the guest, rather than the host, which way up it is.
   *
   * Accessibility is the only channel that answers for the guest: its frames come
   * back in the rotated screen's own point space, so the root frame swaps width and
   * height exactly when the guest really turned. Nothing on the display port carries
   * orientation — the framebuffer keeps its portrait shape either way.
   *
   * It can only see quarter turns. The two portraits look alike to it, as do the two
   * landscapes, so a half turn is still taken on trust.
   */
  private async confirmRotation(
    sessionId: string,
    target: IosSimulatorOrientation,
    previous: IosSimulatorOrientation,
  ): Promise<boolean> {
    const wantLandscape = isIosSimulatorLandscape(target)
    if (wantLandscape === isIosSimulatorLandscape(previous)) return true

    const deadline = Date.now() + this.rotationConfirmMs
    for (;;) {
      // Only the root frame is read, so the dump is kept to it.
      const frame = await this.rootAccessibilityFrame(sessionId)
      // `null` means this helper cannot see the guest at all. Verifying is a bonus,
      // not a precondition — refusing here would take away a control that works.
      if (frame === null) return true
      const [, , width, height] = frame
      // A guest mid-launch reports a zero-sized root; that is not a portrait reading.
      if (width > 0 && height > 0 && width > height === wantLandscape) return true
      if (Date.now() >= deadline) return false
      await delay(this.rotationPollMs)
    }
  }

  private async rootAccessibilityFrame(
    sessionId: string,
  ): Promise<[number, number, number, number] | null> {
    try {
      const dump = await this.accessibilityDump(sessionId, { maxDepth: 1, maxNodes: 1 })
      return dump.tree.frame ?? null
    } catch {
      return null
    }
  }

  private async publishSessionState(sessionId: string): Promise<void> {
    if (this.stateListeners.size === 0) return
    try {
      const state = await this.getSessionState(sessionId)
      for (const listener of this.stateListeners) listener(state)
    } catch (error) {
      log.warn('[ios-simulator] could not publish session state', sessionId, error)
    }
  }

  /**
   * Read the guest's semantic tree.
   *
   * Unlike `input` this has no fallback path. A device whose accessibility channel
   * refused to bind cannot be observed semantically, and returning an empty tree
   * would read to a caller as "the screen is blank" rather than "I cannot see".
   */
  async accessibilityDump(
    sessionId: string,
    options: { maxDepth?: number; maxNodes?: number } = {},
  ): Promise<IosSimulatorAccessibilityDump> {
    const native = await this.requireNativeSession(sessionId)
    return native.client.dumpAccessibility(options)
  }

  /**
   * A perceptual fingerprint of what the screen shows right now.
   *
   * The second source for "did anything change", and the only one for an app with no
   * accessibility tree. Unlike `accessibilityDump` this cannot be refused by the
   * guest -- it reads the same pixels the user is looking at.
   */
  async frameHash(sessionId: string): Promise<IosSimulatorFrameHash> {
    const native = await this.requireNativeSession(sessionId)
    return native.client.frameHash()
  }

  /** Recognized text with boxes, for screens the accessibility tree does not describe. */
  async frameOcr(
    sessionId: string,
    options: IosSimulatorFrameOcrOptions,
  ): Promise<IosSimulatorFrameOcr> {
    const native = await this.requireNativeSession(sessionId)
    return native.client.frameOcr(options)
  }

  /**
   * Drive a control through accessibility rather than touch.
   *
   * `generation` is the dump the uid came from; the helper refuses a mismatch
   * instead of acting on whatever now occupies that slot.
   */
  async accessibilityPerform(
    sessionId: string,
    action: string,
    generation: number,
    uid: number,
  ): Promise<void> {
    const native = await this.requireNativeSession(sessionId)
    await native.client.performAccessibility(action, generation, uid)
  }

  private async requireNativeSession(sessionId: string) {
    const udid = this.sessionBindings.get(sessionId)
    if (!udid) throw new Error('No simulator is bound to this session.')
    return this.ensureNativeSession(sessionId, udid)
  }

  /** Writes a PNG of the device's own display, at its native resolution. */
  async screenshot(sessionId: string): Promise<IosSimulatorCapture> {
    const { udid, deviceName } = await this.requireCaptureTarget(sessionId)
    const capture = this.captureFor(sessionId, deviceName, 'screenshot', 'png')
    await this.capture.screenshot(udid, capture.path)
    return capture
  }

  isRecording(sessionId: string): boolean {
    return this.recordings.has(sessionId)
  }

  /** Resolves once simctl confirms the recording is running, not merely spawned. */
  async startRecording(sessionId: string): Promise<IosSimulatorCapture> {
    if (this.recordings.has(sessionId)) throw new Error('This simulator is already recording.')
    const { udid, deviceName } = await this.requireCaptureTarget(sessionId)
    const capture = this.captureFor(sessionId, deviceName, 'video', 'mp4')
    const flight = this.capture.startRecording(udid, capture.path)
    // Registered before the await so a stop arriving mid-start still finds it.
    this.recordings.set(sessionId, { flight, capture })
    try {
      await flight
    } catch (error) {
      this.recordings.delete(sessionId)
      throw error
    }
    return capture
  }

  /** Returns the finished file, or null when this session was not recording. */
  async stopRecording(sessionId: string): Promise<IosSimulatorCapture | null> {
    const current = this.recordings.get(sessionId)
    if (!current) return null
    this.recordings.delete(sessionId)
    // A start that already failed has nothing to signal, and its rejection was
    // reported to whoever pressed record.
    const recording = await current.flight.catch(() => null)
    if (!recording) return null
    await recording.stop()
    return current.capture
  }

  subscribe(
    sessionId: string,
    listener: (frame: IosSimulatorFrame) => void,
    preferredMode: 'native-framebuffer' | 'native-h264' = 'native-h264',
    quality: IosSimulatorPreviewQuality = DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY,
  ): () => void {
    let stream = this.streams.get(sessionId)
    if (!stream) {
      stream = {
        listeners: new Set(), sequence: 0, started: false,
        preferredMode, activeMode: preferredMode, quality, lastConfigFrame: null,
      }
      this.streams.set(sessionId, stream)
    }
    stream.listeners.add(listener)
    // Joining a stream that is already running: the config frame went out before
    // this listener existed, and the helper will not send another until the stream
    // is torn down and reopened. Replaying it is the only way a second window's
    // decoder ever gets configured.
    if (stream.lastConfigFrame) listener(stream.lastConfigFrame)
    void this.startStream(sessionId)
    return () => {
      const current = this.streams.get(sessionId)
      current?.listeners.delete(listener)
      if (current?.listeners.size === 0) void this.stopStream(sessionId, false)
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.recordings.keys()].map((id) => this.stopRecording(id)))
    for (const sessionId of [...this.streams.keys()]) await this.stopStream(sessionId)
    await Promise.allSettled([...this.nativeSessions.keys()].map((id) => this.disposeNativeSession(id)))
    await Promise.allSettled([...this.superOneBooted].map((udid) => this.simctl.shutdown(udid)))
    this.superOneBooted.clear()
    this.sessionBindings.clear()
    this.deviceOwners.clear()
  }

  /**
   * Everything this session holds on the device, released in the one order that
   * works: simctl can only finalise a movie while the device it reads from is still
   * up, and a stream left marked `started` would never reopen on whatever comes
   * next. Every caller that lets go of a binding goes through here.
   */
  private async teardownSession(sessionId: string): Promise<void> {
    await this.stopRecording(sessionId)
    await this.stopStream(sessionId)
    await this.disposeNativeSession(sessionId)
  }

  private async requireCaptureTarget(sessionId: string): Promise<{ udid: string; deviceName: string }> {
    const udid = this.sessionBindings.get(sessionId)
    if (!udid) throw new Error('No simulator is bound to this session.')
    const device = (await this.listDevices()).find((entry) => entry.udid === udid)
    if (!device?.booted) throw new Error('The simulator is not running.')
    return { udid, deviceName: device.name }
  }

  private captureFor(
    sessionId: string,
    deviceName: string,
    kind: IosSimulatorCaptureKind,
    extension: string,
  ): IosSimulatorCapture {
    const fileName = captureFileName(deviceName, extension, new Date())
    return { kind, fileName, path: join(this.captureRoot, sessionId, fileName) }
  }

  private unbind(sessionId: string, udid: string | undefined): void {
    this.sessionBindings.delete(sessionId)
    if (udid && this.deviceOwners.get(udid) === sessionId) this.deviceOwners.delete(udid)
  }

  /** Serialises every open/close for one session behind the previous one. */
  private queueStreamWork(sessionId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.streamFlights.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.streamFlights.set(sessionId, next)
    void next.catch(() => undefined).then(() => {
      if (this.streamFlights.get(sessionId) === next) this.streamFlights.delete(sessionId)
    })
    return next
  }

  private async ensureNativeSession(sessionId: string, udid: string): Promise<NativeSession> {
    const existing = this.nativeSessions.get(sessionId)
    // `alive` and not just the udid: a helper that exited left this session holding a
    // runtime that answers every request with "HID input is unavailable", and without
    // this check the only way out was for the user to hit Refresh.
    if (existing?.udid === udid && existing.client.alive) return existing
    const inflight = this.nativeFlights.get(sessionId)
    if (inflight) return inflight
    // The dead helper took its frame stream with it. Clearing `started` is what lets
    // the reopen below reach `startFrames` again, and the cached config frame
    // describes an encoder that no longer exists.
    const crashed = existing !== undefined && !existing.client.alive
    if (crashed) {
      const stream = this.streams.get(sessionId)
      if (stream) {
        stream.started = false
        stream.lastConfigFrame = null
      }
    }
    const flight = (async () => {
      if (existing) await this.disposeNativeSession(sessionId)
      const client = await this.nativeFactory()
      let lastError: unknown
      for (let attempt = 0; attempt < this.attachAttempts; attempt++) {
        try {
          await client.attach(udid)
          const session = { udid, client }
          this.nativeSessions.set(sessionId, session)
          return session
        } catch (error) {
          lastError = error
          if (attempt + 1 < this.attachAttempts) await delay(this.attachRetryMs)
        }
      }
      await client.dispose()
      throw lastError instanceof Error ? lastError : new Error('Could not attach the native iOS helper.')
    })().finally(() => this.nativeFlights.delete(sessionId))
    this.nativeFlights.set(sessionId, flight)
    // Queued after the rebuild rather than inside it: `openStream` awaits this very
    // flight, so starting it from within would have it wait on itself.
    if (crashed) void flight.then(() => this.startStream(sessionId), () => undefined)
    return flight
  }

  private startStream(sessionId: string): Promise<void> {
    return this.queueStreamWork(sessionId, () => this.openStream(sessionId))
  }

  private async openStream(sessionId: string): Promise<void> {
    const stream = this.streams.get(sessionId)
    const udid = this.sessionBindings.get(sessionId)
    if (!stream || !udid || stream.started || stream.listeners.size === 0) return
    try {
      const native = await this.ensureNativeSession(sessionId, udid)
      if (!this.streams.has(sessionId)) return
      const info = await native.client.startFrames(
        stream.preferredMode,
        stream.quality,
        (frame) => this.emitFrame(sessionId, frame),
      )
      if (this.streams.get(sessionId) !== stream || stream.listeners.size === 0) {
        await native.client.closeFrames()
        return
      }
      stream.activeMode = info.codec === 'h264' ? 'native-h264' : 'native-framebuffer'
      stream.started = true
    } catch (error) {
      // Swallowing this used to strand the panel on its loading spinner with no
      // trace anywhere: the stream simply never produced a frame.
      stream.started = false
      this.onStreamError(sessionId, error)
    }
  }

  private emitFrame(sessionId: string, packet: NativeFramePacket): void {
    const stream = this.streams.get(sessionId)
    if (!stream) return
    // The negotiated size, not the attachment size: a scaled preview encodes
    // smaller than the device's framebuffer, and this is what configures the decoder.
    const negotiated = this.nativeSessions.get(sessionId)?.client.streamInfo
    const codecConfig = packet.kind === 'h264-config'
    const codec = codecConfig ? packet.data.toString('utf8') : undefined
    const frame: IosSimulatorFrame = {
      sessionId,
      sequence: ++stream.sequence,
      timestampMs: Math.floor(packet.timestampUs / 1_000),
      timestampUs: packet.timestampUs,
      mimeType: packet.kind === 'png' ? 'image/png' : 'video/avc',
      keyframe: packet.keyframe,
      codecConfig,
      ...(codec ? { codec } : {}),
      ...(codecConfig && negotiated ? {
        codedWidth: negotiated.pixelWidth,
        codedHeight: negotiated.pixelHeight,
      } : {}),
      // A view, not a copy: the parser hands every record its own exactly-sized,
      // unpooled buffer, so structured clone has nothing to copy but the payload
      // and the 16 header bytes in front of it.
      data: codecConfig
        ? new Uint8Array()
        : new Uint8Array(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength),
    }
    if (codecConfig) stream.lastConfigFrame = frame
    for (const callback of stream.listeners) callback(frame)
  }

  /**
   * `force` distinguishes the two callers: unbinding always tears the stream down,
   * whereas the last unsubscribe only asks for it, because a remount can re-subscribe
   * before the request reaches the front of the queue.
   */
  private stopStream(sessionId: string, force = true): Promise<void> {
    return this.queueStreamWork(sessionId, () => this.closeStream(sessionId, force))
  }

  private async closeStream(sessionId: string, force: boolean): Promise<void> {
    const stream = this.streams.get(sessionId)
    if (!stream) return
    if (!force && stream.listeners.size > 0) return
    this.streams.delete(sessionId)
    stream.listeners.clear()
    await this.nativeSessions.get(sessionId)?.client.closeFrames()
  }

  private async disposeNativeSession(sessionId: string): Promise<void> {
    const inflight = this.nativeFlights.get(sessionId)
    if (inflight) await inflight.catch(() => undefined)
    const native = this.nativeSessions.get(sessionId)
    this.nativeSessions.delete(sessionId)
    await native?.client.dispose()
  }

  private emptyState(sessionId: string): IosSimulatorSessionState {
    return {
      sessionId,
      device: null,
      phase: 'idle',
      previewMode: 'native-h264',
      interactive: false,
      orientation: 'portrait',
      hardwareKeyboardConnected: true,
      hardwareKeyboardAvailable: false,
      message: 'Select a simulator to begin.',
    }
  }
}
