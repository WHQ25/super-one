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
  isIosSimulatorTextTypeable,
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
  SimctlCapture,
  type IosSimulatorCapturePort,
  type IosSimulatorRecording,
} from './capture'
import { captureFileName } from '../device/capture-path'
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
  /**
   * Device (udid) -> the session holding it. The single source of truth for ownership.
   *
   * One simulator belongs to at most one session; a session may hold several. Every
   * other map here is keyed by udid for the same reason: an attachment, a stream and
   * a recording belong to a DEVICE, not to whoever is watching it.
   */
  private readonly owners = new Map<string, string>()

  /** udid -> the name the last listing saw. For messages only; see `withOwnership`. */
  private readonly deviceNames = new Map<string, string>()
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
  private readonly onStreamError: (udid: string, error: unknown) => void
  private readonly watchExternalSimulator: () => () => void
  /** Non-null exactly while the watcher is running, so it is started only once. */
  private stopExternalSimulatorWatch: (() => void) | null = null
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
    this.watchExternalSimulator = options.watchExternalSimulator ?? (() => () => undefined)
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
    return devices.map((device) => this.withOwnership(device))
  }

  /**
   * Stamp host-owned facts onto a simctl row. Ownership lives here, not in simctl,
   * so a row read a moment before a binding changed has to be stamped again rather
   * than re-fetched — which is why the old value is dropped rather than spread over.
   */
  private withOwnership(device: IosSimulatorDevice): IosSimulatorDevice {
    const owner = this.owners.get(device.udid)
    // Recorded on the way past so a device can be NAMED without a second `simctl
    // list` — the agent's target resolution runs on every action and cannot afford
    // one. Only ever used in messages; nothing routes on it.
    this.deviceNames.set(device.udid, device.name)
    const { boundSessionId: _previous, ...rest } = device
    return {
      ...rest,
      ownedBySuperOne: this.superOneBooted.has(device.udid),
      ...(owner ? { boundSessionId: owner } : {}),
    }
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
    const owner = this.owners.get(udid)
    if (owner && owner !== sessionId) {
      throw new Error(`Simulator ${udid} is already bound to session ${owner}.`)
    }
    const device = (await this.listDevices()).find((candidate) => candidate.udid === udid)
    if (!device) throw new Error(`Simulator ${udid} was not found.`)
    if (!device.available) throw new Error(device.availabilityError ?? `Simulator ${udid} is unavailable.`)

    // No "previous device" to give up: a session may hold several at once, so
    // letting one go is a decision its holder makes explicitly, through `detach`.
    this.owners.set(udid, sessionId)
    if (device.booted) await this.ensureNativeSession(udid)
    // The row read above, not a fresh one: nothing between here and there changes what
    // simctl would say about this device — attaching the helper does not boot it — and
    // the only field that DID change is the ownership this session just took.
    return this.announce(this.sessionStateFor(udid, this.withOwnership(device)))
  }

  async boot(sessionId: string, udid: string): Promise<IosSimulatorSessionState> {
    const before = (await this.listDevices()).find((candidate) => candidate.udid === udid)
    if (!before) throw new Error(`Simulator ${udid} was not found.`)
    await this.bind(sessionId, udid)
    if (!before.booted) {
      await this.powerOn(before)
      await this.ensureNativeSession(udid)
    }
    return this.announce(await this.getSessionState(udid))
  }

  /**
   * Turn a simulator on without taking it.
   *
   * Split out of `boot` because starting a device and being allowed to DRIVE it are
   * two different questions: the agent may boot one on its own, while the binding
   * that follows still has to be granted. Deliberately does none of what `bind` does
   * — no ownership, no helper attach — so a simulator powered on here is exactly what
   * a simulator the user started themselves is, plus an entry in `superOneBooted` so
   * shutdown still knows we are the ones who started it.
   */
  async power(udid: string): Promise<IosSimulatorDevice> {
    const device = (await this.listDevices()).find((candidate) => candidate.udid === udid)
    if (!device) throw new Error(`Simulator ${udid} was not found.`)
    if (!device.available) {
      throw new Error(device.availabilityError ?? `Simulator ${udid} is unavailable.`)
    }
    if (device.booted) return device
    await this.powerOn(device)
    // Re-read rather than patching `booted` in: the caller renders this row, and
    // simctl is the only thing that can say the device actually came up.
    return (await this.listDevices()).find((candidate) => candidate.udid === udid)
      ?? { ...device, booted: true }
  }

  /** The power half of `boot`, given a row `listDevices` just produced. */
  private async powerOn(device: IosSimulatorDevice): Promise<void> {
    if (device.booted) return
    await this.simctl.boot(device.udid)
    this.superOneBooted.add(device.udid)
    this.syncExternalSimulatorWatch()
  }

  /**
   * Closes the preview and gives the simulator up without stopping it. Ownership is
   * dropped too, so neither closing the panel nor quitting the app takes it down
   * later — it becomes an ordinary running simulator the launcher can attach to.
   */
  async detach(udid: string): Promise<IosSimulatorSessionState> {
    await this.teardownSession(udid)
    this.unbind(udid)
    this.superOneBooted.delete(udid)
    this.syncExternalSimulatorWatch()
    return this.announce(this.emptyState(udid))
  }

  /** Shuts the device down for real, whoever booted it, and unbinds the session. */
  async shutdown(udid: string): Promise<IosSimulatorSessionState> {
    await this.teardownSession(udid)
    await this.simctl.shutdown(udid)
    this.superOneBooted.delete(udid)
    this.syncExternalSimulatorWatch()
    this.orientations.delete(udid)
    this.hardwareKeyboards.delete(udid)
    this.unbind(udid)
    return this.announce(this.emptyState(udid))
  }

  /** Every simulator this session held, on its way out. */
  /** Put the device back the way it was found. See `DeviceSurface.release`. */
  async releaseDevice(udid: string): Promise<void> {
    await this.teardownSession(udid)
    this.unbind(udid)
    // Closing the panel puts the simulator back the way it was found: shut down
    // what we booted, leave an externally booted simulator running.
    if (this.superOneBooted.has(udid)) {
      this.superOneBooted.delete(udid)
      this.syncExternalSimulatorWatch()
      this.orientations.delete(udid)
      this.hardwareKeyboards.delete(udid)
      await this.simctl.shutdown(udid)
    }
    this.announce(this.emptyState(udid))
  }

  /**
   * `devices` is an already-read catalog. `simctl list devices --json` is a process
   * spawn against CoreSimulatorService — a quarter of a second on an idle Mac — and a
   * caller that has just listed them (`device_list`, `device_request_control`) would
   * otherwise pay for a second identical one.
   */
  /**
   * Every simulator this session holds, in no particular order.
   *
   * Read off `owners` rather than a per-session index: ownership is the fact, and a
   * second structure alongside it is a second thing to get out of step.
   */
  devicesOf(sessionId: string): string[] {
    return [...this.owners].filter(([, owner]) => owner === sessionId).map(([udid]) => udid)
  }

  /**
   * The one simulator this session holds, when it holds exactly one.
   *
   * Null for none AND for several: with two in hand there is no default that is not
   * a guess, and guessing wrong means driving the wrong app.
   */
  /** The name the last listing saw for this simulator, if any. */
  nameOf(udid: string): string | null {
    return this.deviceNames.get(udid) ?? null
  }

  soleDeviceOf(sessionId: string): string | null {
    const held = this.devicesOf(sessionId)
    return held.length === 1 ? held[0]! : null
  }

  async getSessionState(
    udid: string,
    devices?: IosSimulatorDevice[],
  ): Promise<IosSimulatorSessionState> {
    if (!this.owners.has(udid)) return this.emptyState(udid)
    const catalog = devices ?? await this.listDevices()
    const device = catalog.find((candidate) => candidate.udid === udid) ?? null
    return this.sessionStateFor(udid, device)
  }

  /**
   * The same reading, from a device row the caller has ALREADY read.
   *
   * `simctl list devices --json` is a process spawn that talks to CoreSimulatorService
   * — a quarter of a second on an idle Mac and worse with a simulator running. `bind`
   * used to read the list for its own checks and then call `getSessionState`, which
   * read it again, so opening the panel cost three of these back to back before the
   * preview could show anything. Everything below this line is synchronous; the list
   * was the only reason the reading had to be awaited at all.
   */
  private sessionStateFor(
    udid: string,
    device: IosSimulatorDevice | null,
  ): IosSimulatorSessionState {
    const attachment = this.nativeSessions.get(udid)?.client.attachment
    return {
      udid,
      sessionId: this.owners.get(udid) ?? '',
      device,
      phase: device?.booted ? 'ready' : 'idle',
      previewMode: this.streams.get(udid)?.activeMode ?? 'native-h264',
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

  async input(udid: string, input: IosSimulatorInput): Promise<IosSimulatorInputResult> {
    if (!this.owners.has(udid)) return { ok: false, error: `${udid} is not bound to a session.` }
    try {
      const native = await this.ensureNativeSession(udid)
      // Long or non-ASCII text goes straight into the focused control. HID usage
      // codes cannot spell Chinese or emoji, and replaying a paragraph as individual
      // keys needlessly holds the serial input queue for seconds.
      if (input.type === 'text' && !canTypeIosSimulatorText(input.text)) {
        const inserted = await native.client.input({ type: 'insertText', text: input.text })
        if (inserted.ok || !isIosSimulatorTextTypeable(input.text)) return inserted
        // Secure/custom controls commonly reject AXValue even though ordinary HID
        // keystrokes still work. Long ASCII is slower that way, but must not become
        // impossible merely because the fast path is unavailable.
        return native.client.input(input)
      }
      const result = await native.client.input(input)
      if (input.type === 'rotate') return this.settleRotation(udid, input.orientation, result)
      if (input.type === 'keyboard' && result.ok) {
        this.hardwareKeyboards.set(udid, input.connected)
        await this.publishSessionState(udid)
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
    udid: string,
    orientation: IosSimulatorOrientation,
    result: IosSimulatorInputResult,
  ): Promise<IosSimulatorInputResult> {
    const previous = this.orientations.get(udid) ?? 'portrait'
    const turned = result.ok && await this.confirmRotation(udid, orientation, previous)
    if (turned) this.orientations.set(udid, orientation)
    // Published on refusal too: the panel turns its shell the moment the user clicks
    // the button, so something has to be able to turn it back. Awaited rather than
    // fired off, so a caller that reads the state back cannot beat its own event.
    await this.publishSessionState(udid)
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
    udid: string,
    target: IosSimulatorOrientation,
    previous: IosSimulatorOrientation,
  ): Promise<boolean> {
    const wantLandscape = isIosSimulatorLandscape(target)
    if (wantLandscape === isIosSimulatorLandscape(previous)) return true

    const deadline = Date.now() + this.rotationConfirmMs
    for (;;) {
      // Only the root frame is read, so the dump is kept to it.
      const frame = await this.rootAccessibilityFrame(udid)
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
    udid: string,
  ): Promise<[number, number, number, number] | null> {
    try {
      const dump = await this.accessibilityDump(udid, { maxDepth: 1, maxNodes: 1 })
      return dump.tree.frame ?? null
    } catch {
      return null
    }
  }

  /**
   * Hand the state back to the caller and tell every renderer about it at once.
   *
   * Lifecycle transitions used to answer only their caller, which was enough while
   * every bind and boot came from the panel that made the IPC call. `device_request_control`
   * broke that: the agent boots a device no renderer asked for, so a window with no
   * return value to read has no other way to learn it now has something to show.
   */
  private announce(state: IosSimulatorSessionState): IosSimulatorSessionState {
    for (const listener of this.stateListeners) listener(state)
    return state
  }

  private async publishSessionState(udid: string): Promise<void> {
    if (this.stateListeners.size === 0) return
    try {
      this.announce(await this.getSessionState(udid))
    } catch (error) {
      log.warn('[ios-simulator] could not publish session state', udid, error)
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
    udid: string,
    options: { maxDepth?: number; maxNodes?: number } = {},
  ): Promise<IosSimulatorAccessibilityDump> {
    const native = await this.requireNativeSession(udid)
    return native.client.dumpAccessibility(options)
  }

  /**
   * A perceptual fingerprint of what the screen shows right now.
   *
   * The second source for "did anything change", and the only one for an app with no
   * accessibility tree. Unlike `accessibilityDump` this cannot be refused by the
   * guest -- it reads the same pixels the user is looking at.
   */
  async frameHash(udid: string): Promise<IosSimulatorFrameHash> {
    const native = await this.requireNativeSession(udid)
    return native.client.frameHash()
  }

  /** Recognized text with boxes, for screens the accessibility tree does not describe. */
  async frameOcr(
    udid: string,
    options: IosSimulatorFrameOcrOptions,
  ): Promise<IosSimulatorFrameOcr> {
    const native = await this.requireNativeSession(udid)
    return native.client.frameOcr(options)
  }

  /**
   * Drive a control through accessibility rather than touch.
   *
   * `generation` is the dump the uid came from; the helper refuses a mismatch
   * instead of acting on whatever now occupies that slot.
   */
  async accessibilityPerform(
    udid: string,
    action: string,
    generation: number,
    uid: number,
  ): Promise<void> {
    const native = await this.requireNativeSession(udid)
    await native.client.performAccessibility(action, generation, uid)
  }

  private async requireNativeSession(udid: string) {
    if (!this.owners.has(udid)) throw new Error(`${udid} is not bound to a session.`)
    return this.ensureNativeSession(udid)
  }

  /** Writes a PNG of the device's own display, at its native resolution. */
  async screenshot(udid: string): Promise<IosSimulatorCapture> {
    const { deviceName } = await this.requireCaptureTarget(udid)
    const capture = this.captureFor(udid, deviceName, 'screenshot', 'png')
    await this.capture.screenshot(udid, capture.path)
    return capture
  }

  isRecording(udid: string): boolean {
    return this.recordings.has(udid)
  }

  /** Resolves once simctl confirms the recording is running, not merely spawned. */
  async startRecording(udid: string): Promise<IosSimulatorCapture> {
    if (this.recordings.has(udid)) throw new Error('This simulator is already recording.')
    const { deviceName } = await this.requireCaptureTarget(udid)
    const capture = this.captureFor(udid, deviceName, 'video', 'mp4')
    const flight = this.capture.startRecording(udid, capture.path)
    // Registered before the await so a stop arriving mid-start still finds it.
    this.recordings.set(udid, { flight, capture })
    try {
      await flight
    } catch (error) {
      this.recordings.delete(udid)
      throw error
    }
    return capture
  }

  /** Returns the finished file, or null when this session was not recording. */
  async stopRecording(udid: string): Promise<IosSimulatorCapture | null> {
    const current = this.recordings.get(udid)
    if (!current) return null
    this.recordings.delete(udid)
    // A start that already failed has nothing to signal, and its rejection was
    // reported to whoever pressed record.
    const recording = await current.flight.catch(() => null)
    if (!recording) return null
    await recording.stop()
    return current.capture
  }

  subscribe(
    udid: string,
    listener: (frame: IosSimulatorFrame) => void,
    preferredMode: 'native-framebuffer' | 'native-h264' = 'native-h264',
    quality: IosSimulatorPreviewQuality = DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY,
  ): () => void {
    let stream = this.streams.get(udid)
    if (!stream) {
      stream = {
        listeners: new Set(), sequence: 0, started: false,
        preferredMode, activeMode: preferredMode, quality, lastConfigFrame: null,
      }
      this.streams.set(udid, stream)
    }
    stream.listeners.add(listener)
    // Joining a stream that is already running: the config frame went out before
    // this listener existed, and the helper will not send another until the stream
    // is torn down and reopened. Replaying it is the only way a second window's
    // decoder ever gets configured.
    if (stream.lastConfigFrame) listener(stream.lastConfigFrame)
    void this.startStream(udid)
    return () => {
      const current = this.streams.get(udid)
      current?.listeners.delete(listener)
      if (current?.listeners.size === 0) void this.stopStream(udid, false)
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.recordings.keys()].map((id) => this.stopRecording(id)))
    for (const udid of [...this.streams.keys()]) await this.stopStream(udid)
    await Promise.allSettled([...this.nativeSessions.keys()].map((id) => this.disposeNativeSession(id)))
    await Promise.allSettled([...this.superOneBooted].map((udid) => this.simctl.shutdown(udid)))
    this.superOneBooted.clear()
    this.syncExternalSimulatorWatch()
    this.owners.clear()
  }

  /**
   * Run the external-Simulator watcher exactly while this app owns a device it booted.
   *
   * Keyed on `superOneBooted` rather than on bindings: a simulator the USER already
   * had running is one they were plausibly watching in Simulator.app on purpose, and
   * taking over its preview here is not a reason to pull their window out from under
   * them. Idempotent, so every caller can just say "resync" after touching the ledger.
   */
  private syncExternalSimulatorWatch(): void {
    const wanted = this.superOneBooted.size > 0
    if (wanted === (this.stopExternalSimulatorWatch !== null)) return
    if (wanted) {
      this.stopExternalSimulatorWatch = this.watchExternalSimulator()
      return
    }
    this.stopExternalSimulatorWatch?.()
    this.stopExternalSimulatorWatch = null
  }

  /**
   * Everything this session holds on the device, released in the one order that
   * works: simctl can only finalise a movie while the device it reads from is still
   * up, and a stream left marked `started` would never reopen on whatever comes
   * next. Every caller that lets go of a binding goes through here.
   */
  private async teardownSession(udid: string): Promise<void> {
    await this.stopRecording(udid)
    await this.stopStream(udid)
    await this.disposeNativeSession(udid)
  }

  private async requireCaptureTarget(udid: string): Promise<{ udid: string; deviceName: string }> {
    if (!this.owners.has(udid)) throw new Error(`${udid} is not bound to a session.`)
    const device = (await this.listDevices()).find((entry) => entry.udid === udid)
    if (!device?.booted) throw new Error('The simulator is not running.')
    return { udid, deviceName: device.name }
  }

  /**
   * Where a capture lands. Filed under the DEVICE, not the session that took it:
   * a session may hold several devices, and their screenshots in one folder could
   * not be told apart.
   */
  private captureFor(
    udid: string,
    deviceName: string,
    kind: IosSimulatorCaptureKind,
    extension: string,
  ): IosSimulatorCapture {
    const fileName = captureFileName(deviceName, extension, new Date())
    return { kind, fileName, path: join(this.captureRoot, udid, fileName) }
  }

  private unbind(udid: string): void {
    this.owners.delete(udid)
  }

  /** Serialises every open/close for one session behind the previous one. */
  private queueStreamWork(udid: string, work: () => Promise<void>): Promise<void> {
    const previous = this.streamFlights.get(udid) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.streamFlights.set(udid, next)
    void next.catch(() => undefined).then(() => {
      if (this.streamFlights.get(udid) === next) this.streamFlights.delete(udid)
    })
    return next
  }

  private async ensureNativeSession(udid: string): Promise<NativeSession> {
    const existing = this.nativeSessions.get(udid)
    // `alive` and not just the udid: a helper that exited left this session holding a
    // runtime that answers every request with "HID input is unavailable", and without
    // this check the only way out was for the user to hit Refresh.
    if (existing?.udid === udid && existing.client.alive) return existing
    const inflight = this.nativeFlights.get(udid)
    if (inflight) return inflight
    // The dead helper took its frame stream with it. Clearing `started` is what lets
    // the reopen below reach `startFrames` again, and the cached config frame
    // describes an encoder that no longer exists.
    const crashed = existing !== undefined && !existing.client.alive
    if (crashed) {
      const stream = this.streams.get(udid)
      if (stream) {
        stream.started = false
        stream.lastConfigFrame = null
      }
    }
    const flight = (async () => {
      if (existing) await this.disposeNativeSession(udid)
      const client = await this.nativeFactory()
      let lastError: unknown
      for (let attempt = 0; attempt < this.attachAttempts; attempt++) {
        try {
          await client.attach(udid)
          const session = { udid, client }
          this.nativeSessions.set(udid, session)
          return session
        } catch (error) {
          lastError = error
          if (attempt + 1 < this.attachAttempts) await delay(this.attachRetryMs)
        }
      }
      await client.dispose()
      throw lastError instanceof Error ? lastError : new Error('Could not attach the native iOS helper.')
    })().finally(() => this.nativeFlights.delete(udid))
    this.nativeFlights.set(udid, flight)
    // Queued after the rebuild rather than inside it: `openStream` awaits this very
    // flight, so starting it from within would have it wait on itself.
    if (crashed) void flight.then(() => this.startStream(udid), () => undefined)
    return flight
  }

  private startStream(udid: string): Promise<void> {
    return this.queueStreamWork(udid, () => this.openStream(udid))
  }

  private async openStream(udid: string): Promise<void> {
    const stream = this.streams.get(udid)
    if (!stream || !this.owners.has(udid) || stream.started || stream.listeners.size === 0) return
    try {
      const native = await this.ensureNativeSession(udid)
      if (!this.streams.has(udid)) return
      const info = await native.client.startFrames(
        stream.preferredMode,
        stream.quality,
        (frame) => this.emitFrame(udid, frame),
      )
      if (this.streams.get(udid) !== stream || stream.listeners.size === 0) {
        await native.client.closeFrames()
        return
      }
      stream.activeMode = info.codec === 'h264' ? 'native-h264' : 'native-framebuffer'
      stream.started = true
    } catch (error) {
      // Swallowing this used to strand the panel on its loading spinner with no
      // trace anywhere: the stream simply never produced a frame.
      stream.started = false
      this.onStreamError(udid, error)
    }
  }

  private emitFrame(udid: string, packet: NativeFramePacket): void {
    const stream = this.streams.get(udid)
    if (!stream) return
    // The negotiated size, not the attachment size: a scaled preview encodes
    // smaller than the device's framebuffer, and this is what configures the decoder.
    const negotiated = this.nativeSessions.get(udid)?.client.streamInfo
    const codecConfig = packet.kind === 'h264-config'
    const codec = codecConfig ? packet.data.toString('utf8') : undefined
    const frame: IosSimulatorFrame = {
      deviceId: udid,
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
  private stopStream(udid: string, force = true): Promise<void> {
    return this.queueStreamWork(udid, () => this.closeStream(udid, force))
  }

  private async closeStream(udid: string, force: boolean): Promise<void> {
    const stream = this.streams.get(udid)
    if (!stream) return
    if (!force && stream.listeners.size > 0) return
    this.streams.delete(udid)
    stream.listeners.clear()
    await this.nativeSessions.get(udid)?.client.closeFrames()
  }

  private async disposeNativeSession(udid: string): Promise<void> {
    const inflight = this.nativeFlights.get(udid)
    if (inflight) await inflight.catch(() => undefined)
    const native = this.nativeSessions.get(udid)
    this.nativeSessions.delete(udid)
    await native?.client.dispose()
  }

  private emptyState(udid: string): IosSimulatorSessionState {
    return {
      udid,
      sessionId: this.owners.get(udid) ?? '',
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
