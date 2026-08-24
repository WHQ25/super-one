/**
 * Android devices, and which chat session is driving each one.
 *
 * The counterpart to `IosSimulatorManager`, and deliberately much smaller: adb is the
 * transport, so there is no helper process to build, probe, attach or keep alive. What
 * is left is device discovery, session ownership, and getting a cold AVD to the point
 * where it answers.
 *
 * Booting is the one place Android is harder than iOS. `simctl boot <udid>` addresses
 * the device it starts; `emulator -avd X` starts a process that does NOT report the
 * adb port it ends up on. So a launch is followed by a search: wait for a serial to
 * appear, ask each new one its AVD name, and only then know which device was started.
 */

import type { DeviceCapture, DeviceDescriptor, DeviceFrame, DeviceState } from '@superone/shared/device'
import type { DeviceOrientation } from '@superone/shared/device-agent'
import log from '../../logger'
import { Adb, adbPath, emulatorPath, spawnTool, type AdbDevice } from './adb'
import { Avd, parseEmuResponse, type AvdLaunch, type AvdSummary } from './avd'
import { encodeResetVideo } from './scrcpy-control'
import { connectScrcpy, type ScrcpyConnection } from './scrcpy-server'
import { orientationForRotation } from './uiautomator'
import { AndroidVideoStream } from './video-frames'
import { waitForFirstDeviceFrame } from '../preview-ready'
import { AndroidScreenRecorder } from './screen-recording'
import {
  avdDeviceId,
  mergeAndroidDevices,
  serialDeviceId,
  type AndroidRuntimeInfo,
} from './device-discovery'

/**
 * Longest edge of the encoded video.
 *
 * Well under the device's own 2400px: the picture is watched in a panel a few hundred
 * points wide, and the accessibility tree — which is what the agent actually reads —
 * is unaffected by it.
 */
const SCRCPY_MAX_SIZE = 1280

/**
 * Where a vendor might have written the name on the box, best first.
 *
 * `ro.product.model` is the only property Android itself defines, and on everything
 * but a Pixel it holds a part number — `2410DPN6CC` for a Xiaomi 15 Pro. Each vendor
 * keeps the real name somewhere of its own choosing; these are the three that cover
 * most phones in circulation. Read together in one round trip, so the list costs
 * nothing to extend.
 */
const MARKET_NAME_PROPS = [
  // Xiaomi / Redmi / POCO.
  'ro.product.marketname',
  // OPPO, OnePlus, realme.
  'ro.vendor.oplus.market.name',
  // Huawei, Honor.
  'ro.config.marketing_name',
] as const

/** How long a cold emulator gets to appear on adb and finish booting. */
const BOOT_TIMEOUT_MS = 180_000
const BOOT_POLL_MS = 1_000

/** How long a killed emulator gets to leave `adb devices`. Seconds, in practice. */
const SHUTDOWN_TIMEOUT_MS = 30_000
const SHUTDOWN_POLL_MS = 250

export interface AndroidToolchain {
  adb: Adb
  avd: Avd
  /**
   * Path to the adb binary.
   *
   * Carried alongside the client because the scrcpy server is a LONG-LIVED process,
   * and every method on `Adb` waits for its command to exit.
   */
  adbBinary: string
}

export type AndroidScreenRecordingController = Pick<
  AndroidScreenRecorder,
  'isRecording' | 'start' | 'stop' | 'stopAll'
>

/** Stands in for the emulator binary when only platform-tools is installed. */
const notInstalled = async () => ({ stdout: Buffer.from(''), stderr: '', code: 0 })

/** Locate the SDK and build the two clients. Null when there is no SDK to find. */
export function detectAndroidToolchain(env?: NodeJS.ProcessEnv): AndroidToolchain | null {
  const adbBinary = adbPath(env)
  if (!adbBinary) return null
  const adb = new Adb(spawnTool(adbBinary, 'adb'))
  const emulatorBinary = emulatorPath(env)
  // adb without the emulator package is a real configuration — a machine set up only
  // to work with physical devices. Everything except the AVD list still works, so it
  // degrades to an empty list rather than reporting no Android at all.
  const avd = new Avd(emulatorBinary ?? '', emulatorBinary ? spawnTool(emulatorBinary, 'emulator') : notInstalled)
  return { adb, avd, adbBinary }
}

export class AndroidDeviceManager {
  /**
   * Device id -> the session holding it. The single source of truth for ownership.
   *
   * One device belongs to at most one session; a session may hold several. Everything
   * else here is keyed by DEVICE, because a device is the thing that has a connection,
   * an orientation and a picture — the session is only who is looking at it.
   */
  private readonly owners = new Map<string, string>()
  /** Device id -> adb serial, for the ones that are up. */
  private readonly serials = new Map<string, string>()
  /** AVDs this app started, so it can shut down only what it is responsible for. */
  private readonly launched = new Map<string, AvdLaunch>()
  private readonly orientations = new Map<string, DeviceOrientation>()
  private readonly connections = new Map<string, ScrcpyConnection>()
  private readonly connectionFlights = new Map<string, Promise<ScrcpyConnection>>()
  /**
   * Device id -> the one stream decoding its picture, and everyone watching it.
   *
   * Both belong to the CONNECTION rather than to any viewer, because the fact they
   * carry — the stream's parameter sets — arrives exactly once per connection and is
   * needed by every viewer that ever joins it. See `AndroidVideoStream.configFrame`.
   */
  private readonly videos = new Map<string, AndroidVideoStream>()
  private readonly viewers = new Map<string, Set<(frame: DeviceFrame) => void>>()
  private lastDevices: DeviceDescriptor[] = []
  private readonly screenRecorder: AndroidScreenRecordingController

  constructor(
    private readonly toolchain: AndroidToolchain,
    screenRecorder?: AndroidScreenRecordingController,
  ) {
    this.screenRecorder = screenRecorder
      ?? new AndroidScreenRecorder(toolchain.adb, toolchain.adbBinary)
  }

  /**
   * The adb client, for callers that address the device directly.
   *
   * The backend reads the screen with `screencap` and the tree with `uiautomator`,
   * neither of which goes through scrcpy — so it needs adb without also needing a
   * video connection, which is what keeps an agent-only session cheap.
   */
  get adb() { return this.toolchain.adb }

  /**
   * Ask a running device who it is.
   *
   * Every read at once. Each is ~30ms over adb and they are independent, so doing
   * them in sequence would make listing a machine with three devices feel like half a
   * second of nothing.
   */
  private async readRuntimeInfo(serial: string): Promise<AndroidRuntimeInfo> {
    const { adb } = this.toolchain
    const [avdName, sdk, model, characteristics, marketName] = await Promise.all([
      // Only an emulator answers this, which is how an AVD is told apart from a phone
      // without having to ask anything else.
      this.avdNameOf(serial).catch(() => null),
      adb.getProp(serial, 'ro.build.version.sdk').catch(() => ''),
      adb.getProp(serial, 'ro.product.model').catch(() => ''),
      adb.getProp(serial, 'ro.build.characteristics').catch(() => ''),
      this.readMarketName(serial),
    ])
    const apiLevel = Number.parseInt(sdk, 10)
    return {
      serial,
      ...(avdName ? { avdId: avdName } : {}),
      ...(Number.isInteger(apiLevel) && apiLevel > 0 ? { apiLevel } : {}),
      ...(model ? { model } : {}),
      ...(marketName ? { marketName } : {}),
      ...(characteristics ? { characteristics } : {}),
    }
  }

  /** The first market name any vendor on this device answered to. */
  private async readMarketName(serial: string): Promise<string> {
    const values = await Promise.all(
      MARKET_NAME_PROPS.map((prop) => this.toolchain.adb.getProp(serial, prop).catch(() => '')),
    )
    // `getprop` prints an empty line for a property that does not exist, so absence
    // and emptiness are the same thing here.
    return values.find((value) => Boolean(value)) ?? ''
  }

  /**
   * The AVD behind an emulator serial. Null for a physical device.
   *
   * The serial prefix is checked first only to save a round trip: a phone would fail
   * the console command anyway, but it would take a timeout to find out.
   */
  private async avdNameOf(serial: string): Promise<string | null> {
    if (!serial.startsWith('emulator-')) return null
    const output = await this.toolchain.adb.emu(serial, ['avd', 'name']).catch(() => '')
    return parseEmuResponse(output)
  }

  async listDevices(signal?: AbortSignal): Promise<DeviceDescriptor[]> {
    const { adb, avd } = this.toolchain
    const [avds, attached] = await Promise.all([
      avd.list(signal).catch((error: unknown) => {
        log.warn('[android] AVD list failed', error)
        return [] as AvdSummary[]
      }),
      adb.devices(signal).catch((error: unknown) => {
        log.warn('[android] adb devices failed', error)
        return [] as AdbDevice[]
      }),
    ])

    const runtime = new Map<string, AndroidRuntimeInfo>()
    await Promise.all(attached
      // An unauthorized or offline device answers nothing, and asking costs a timeout
      // each. It still appears in the catalog — see `descriptorForPhysical`.
      .filter((device) => device.state === 'device')
      .map(async (device) => {
        runtime.set(device.serial, await this.readRuntimeInfo(device.serial).catch(() => ({
          serial: device.serial,
        })))
      }))

    const devices = mergeAndroidDevices({
      avds,
      attached,
      runtime,
      owners: this.owners,
    })
    this.rememberSerials(devices, runtime)
    this.lastDevices = devices
    return devices
  }

  /** Keep the id -> serial map current, so an action can address what it was granted. */
  private rememberSerials(
    devices: readonly DeviceDescriptor[],
    runtime: ReadonlyMap<string, AndroidRuntimeInfo>,
  ): void {
    this.serials.clear()
    for (const info of runtime.values()) {
      const id = info.avdId ? avdDeviceId(info.avdId) : serialDeviceId(info.serial)
      if (devices.some((device) => device.id === id)) this.serials.set(id, info.serial)
    }
  }

  /** The adb serial for a device id, if it is up. */
  serialFor(deviceId: string): string | null {
    return this.serials.get(deviceId) ?? null
  }

  /**
   * The scrcpy connection to a device, opened on first use.
   *
   * One per DEVICE, shared by the agent and the preview: they are looking at the same
   * screen, and a second connection would mean a second encoder on the guest and two
   * sets of touches arriving out of order.
   *
   * In-flight connections are tracked as well as finished ones — opening takes a
   * second or two, and a snapshot racing the panel would otherwise start a second one
   * before the first had finished announcing itself.
   */
  async connection(deviceId: string): Promise<ScrcpyConnection> {
    const existing = this.connections.get(deviceId)
    if (existing) return existing
    const flight = this.connectionFlights.get(deviceId)
    if (flight) return flight

    const serial = this.serialFor(deviceId)
    if (!serial) throw new Error(`${deviceId} is not a running Android device.`)

    const connect = () => connectScrcpy({
      adb: this.toolchain.adb,
      adbBinary: this.toolchain.adbBinary,
      serial,
      maxSize: SCRCPY_MAX_SIZE,
    })
    const attach = (connection: ScrcpyConnection) => {
      this.connectionFlights.delete(deviceId)
      this.connections.set(deviceId, connection)
      this.pump(deviceId, connection)
      connection.onClosed(() => {
        this.connections.delete(deviceId)
        this.videos.delete(deviceId)
      })
      return connection
    }
    // Keep the first successful path direct: scrcpy can deliver its config packet in
    // the same tick that the promise resolves, so `pump` must attach before another
    // promise hop. The connection itself buffers that gap in production; keeping it
    // direct also makes the ownership explicit here.
    const first = connect().then(attach)
    const opening = first.catch((cause: unknown) => {
      // ADB can accept a forward just before scrcpy's abstract socket is ready, then
      // close it after the apparent connection. A fresh server succeeds immediately
      // in practice; retry here instead of making the user or the next agent action
      // pay for that recovery a minute later.
      log.warn('[android] preview connection failed; retrying once', cause)
      return connect().then(attach)
    }).catch((error: unknown) => {
      this.connectionFlights.delete(deviceId)
      throw error
    })
    this.connectionFlights.set(deviceId, opening)
    return opening
  }

  /** Start the shared scrcpy stream now and wait until it can actually be drawn. */
  async waitForPreview(deviceId: string, signal?: AbortSignal): Promise<void> {
    await this.connection(deviceId)
    await waitForFirstDeviceFrame((listener) => this.subscribe(deviceId, listener), signal)
  }

  /**
   * Wire a fresh connection to everyone who will ever watch it.
   *
   * Once per CONNECTION, not once per viewer. Both of the things attached here are
   * facts about the device rather than about whoever is looking: a packet decodes to
   * one frame no matter how many panels want it, and a rotation happened once.
   * Subscribing used to attach its own pair, which meant N viewers announced the same
   * rotation N times — and, far worse, N private `AndroidVideoStream`s, only the first
   * of which ever saw the connection's single config packet.
   */
  private pump(deviceId: string, connection: ScrcpyConnection): void {
    const video = new AndroidVideoStream()
    this.videos.set(deviceId, video)
    connection.onMedia((packet) => {
      const frame = video.frame(packet, { deviceId, screen: connection.screen })
      for (const viewer of this.viewers.get(deviceId) ?? []) viewer(frame)
    })
    // A rotation re-shapes the framebuffer rather than turning a fixed one, so the
    // decoder has to be told before the next frame arrives at a new size. Reported
    // as a config-less keyframe boundary via the geometry on the following frames.
    connection.onSession((session) => {
      log.info('[android] capture resized', session.width, session.height)
      // A resize IS a rotation on Android, so the panel has to hear about it — it
      // cannot infer the new shape from a framebuffer that never changed.
      void this.readOrientation(deviceId)
        .then(() => this.announce(deviceId))
        .catch(() => this.announce(deviceId))
    })
  }

  /**
   * Watch this device's screen as decodable frames.
   *
   * Both platforms deliver H.264 with a separate config packet, so the renderer
   * decodes them through one path — but the packets are not interchangeable, and
   * `AndroidVideoStream` is what makes them so. scrcpy states the parameter sets
   * exactly once and encodes at whatever profile the guest picked; the simulator
   * repeats them on every keyframe and names its own codec. See that file.
   */
  subscribe(deviceId: string, listener: (frame: DeviceFrame) => void): () => void {
    const viewers = this.viewers.get(deviceId) ?? new Set<(frame: DeviceFrame) => void>()
    this.viewers.set(deviceId, viewers)

    // A connection that is ALREADY up is what makes this viewer a late one: the config
    // packet carrying the stream's parameter sets went past before it was here, and
    // scrcpy never sends a second. Settled synchronously, BEFORE the viewer joins the
    // fan-out, so no picture can reach it ahead of the frame that lets it decode one.
    // A viewer that arrives with the connection, or while one is still opening, needs
    // none of this — the real config packet is still coming to it.
    const live = this.connections.get(deviceId)
    const replay = live
      ? this.videos.get(deviceId)?.configFrame({ deviceId, screen: live.screen })
      : null
    if (live && replay) {
      listener(replay)
      // A configured decoder still has nothing to draw until a keyframe, and the
      // encoder's own are far apart — measured at over 12s on a real phone. Asking
      // costs one control message and buys a picture in a round trip. The viewers
      // already watching get a fresh config packet and keyframe out of it, which is
      // exactly what they are built to handle.
      live.send(encodeResetVideo())
    }
    viewers.add(listener)

    // Opens one if there is none. Nothing is awaited: everything this viewer needs
    // from a NEW connection arrives through `pump`, on the wire, like every other
    // frame.
    void this.connection(deviceId).catch((error: unknown) => {
      log.warn('[android] preview stream failed to start', error)
    })

    return () => { viewers.delete(listener) }
  }

  /** The device's own idea of which way up it is. Cached for `sessionState`. */
  private async readOrientation(deviceId: string): Promise<DeviceOrientation> {
    const serial = this.serialFor(deviceId)
    if (!serial) return 'portrait'
    const raw = await this.toolchain.adb
      .shell(serial, ['settings', 'get', 'system', 'user_rotation'])
      .catch(() => '0')
    const orientation = orientationForRotation(Number.parseInt(raw.trim(), 10))
    this.orientations.set(deviceId, orientation)
    return orientation
  }

  /**
   * Turn the device, and remember which way it went.
   *
   * `accelerometer_rotation` goes off first or the sensor immediately undoes it. The
   * new orientation is announced rather than merely stored: an agent rotating the
   * device behind the panel's back is exactly the case the broadcast exists for.
   */
  async rotate(deviceId: string, rotation: number): Promise<void> {
    const serial = this.serialFor(deviceId)
    if (!serial) return
    await this.toolchain.adb.shell(serial, ['settings', 'put', 'system', 'accelerometer_rotation', '0'])
    await this.toolchain.adb.shell(serial, ['settings', 'put', 'system', 'user_rotation', String(rotation)])
    this.orientations.set(deviceId, orientationForRotation(rotation))
    this.announce(deviceId)
  }

  /**
   * Stop a device.
   *
   * The kill goes to the emulator's own console, not to the process this app spawned.
   * `emulator` execs into a qemu process that is NOT taken down with its parent, so an
   * emulator outlives a restart of this app — after one, `launched` is empty and a
   * signal would land nowhere, leaving a device the user just asked to stop running
   * with nothing left able to reach it. The console command addresses the emulator
   * itself, so it works whoever started it, which is the rule the simulator follows.
   *
   * A phone on someone's desk is not ours to switch off: it has no console, and
   * letting go is the most that happens to it.
   */
  async stopDevice(deviceId: string): Promise<void> {
    const serial = this.serialFor(deviceId)
    const avdId = avdIdFromDeviceId(deviceId)
    await this.screenRecorder.stop(deviceId).catch((error: unknown) => {
      log.warn('[android] could not finalize recording before stopping device', deviceId, error)
    })
    await this.closeConnection(deviceId)
    if (serial?.startsWith('emulator-')) {
      await this.toolchain.adb.emu(serial, ['kill'])
        .then(() => this.waitForGone(serial))
        .catch((error: unknown) => { log.warn('[android] emulator refused to stop', serial, error) })
      this.serials.delete(deviceId)
    }
    if (avdId) this.launched.delete(avdId)
    await this.release(deviceId)
  }

  /**
   * Wait until adb stops reporting the serial.
   *
   * The kill returns as soon as the emulator has heard it, and the device then takes
   * seconds to actually go — while adb still lists it, first as `device` and then as
   * `offline`. The caller re-reads the catalog the moment this resolves, so returning
   * early is exactly what leaves a device the user shut down still marked running.
   */
  private async waitForGone(serial: string): Promise<void> {
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
    while (Date.now() < deadline) {
      const attached = await this.toolchain.adb.devices().catch(() => null)
      // A list that could not be read says nothing about the device; only one that
      // answered and does not name it means the emulator is gone.
      if (attached && !attached.some((device) => device.serial === serial)) return
      await delay(SHUTDOWN_POLL_MS)
    }
    log.warn('[android] emulator still attached after kill', serial)
  }

  private readonly stateListeners = new Set<(state: DeviceState) => void>()

  /** State the panel did not ask for — a rotation the agent made, a stream that died. */
  onState(listener: (state: DeviceState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private announce(deviceId: string): void {
    const state = this.deviceState(deviceId)
    for (const listener of this.stateListeners) listener(state)
  }

  /** What the panel needs to draw this device, in the shared shape. */
  deviceState(deviceId: string): DeviceState {
    const owner = this.owners.get(deviceId) ?? null
    const device = owner ? this.descriptorFor(deviceId) : null
    const connection = this.connections.get(deviceId)
    return {
      deviceId,
      owner,
      device,
      phase: device ? 'ready' : 'idle',
      interactive: Boolean(device),
      orientation: this.orientations.get(deviceId) ?? 'portrait',
      ...(connection && connection.screen.width > 0
        ? { pixelWidth: connection.screen.width, pixelHeight: connection.screen.height }
        : {}),
    }
  }

  private async closeConnection(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId)
    this.connections.delete(deviceId)
    await connection?.close()
  }

  /**
   * Every Android device this session holds, in no particular order.
   *
   * Read off `owners` rather than a per-session index: ownership is the fact, and a
   * second structure alongside it is a second thing to get out of step.
   */
  devicesOf(sessionId: string): string[] {
    return [...this.owners].filter(([, owner]) => owner === sessionId).map(([id]) => id)
  }

  /**
   * The one device this session holds, when it holds exactly one.
   *
   * Null for none AND for several, deliberately: with two devices in hand there is no
   * default that is not a guess, and guessing wrong means driving the wrong app. The
   * agent tools name the device explicitly once they hold more than one.
   */
  soleDeviceOf(sessionId: string): string | null {
    const held = this.devicesOf(sessionId)
    return held.length === 1 ? held[0]! : null
  }

  /** The last-listed descriptor for a device. Null until a listing has seen it. */
  descriptorFor(deviceId: string): DeviceDescriptor | null {
    return this.lastDevices.find((device) => device.id === deviceId) ?? null
  }

  /**
   * Give this session the device, starting it if it is not already up.
   *
   * Taking a device another session holds is allowed — the user was asked — so the
   * previous owner is simply dropped. That mirrors the simulator, where the same
   * transfer is what the prompt warns about.
   */
  async boot(
    sessionId: string,
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<DeviceDescriptor | null> {
    let serial = this.serialFor(deviceId)
    if (!serial) {
      const avdId = avdIdFromDeviceId(deviceId)
      if (!avdId) return null
      serial = await this.launchAndFind(avdId, signal)
      if (!serial) return null
    }
    await this.waitForBoot(serial, signal)

    const devices = await this.listDevices(signal)
    const device = devices.find((candidate) => candidate.id === deviceId)
    if (!device) return null

    const previousOwner = this.owners.get(deviceId)
    if (previousOwner && previousOwner !== sessionId) {
      await this.screenRecorder.stop(deviceId).catch((error: unknown) => {
        log.warn('[android] could not finalize recording during device takeover', deviceId, error)
      })
    }
    this.bind(sessionId, deviceId)
    // Re-read so the descriptor handed back carries the ownership just recorded,
    // rather than the state from a moment before the grant.
    return { ...device, boundSessionId: sessionId }
  }

  /**
   * Hand the device to this session, taking it off whoever had it.
   *
   * Only the DISPLACED side needs tearing down now. A session changing which device
   * it looks at is no longer a thing this can infer -- a session may hold several --
   * so giving one up is the caller's decision, made by calling `release`.
   */
  private bind(sessionId: string, deviceId: string): void {
    // The connection belongs to the device, so a takeover does NOT close it: the new
    // owner wants the same picture, and tearing it down would cost them a reconnect.
    //
    // Nothing extra is sent to the session being displaced. The broadcast below
    // describes the DEVICE and carries its new owner, and every panel subscribes by
    // device — so the one that just lost it is handed the same reading and sees an
    // owner that is no longer itself. That IS the loss notification.
    this.owners.set(deviceId, sessionId)
    this.announce(deviceId)
  }

  /** Give a device up, and stop paying for its stream or recorder. */
  async release(deviceId: string): Promise<void> {
    if (!this.owners.delete(deviceId)) return
    // Both guest encoders run for whoever is watching. Nobody is now. Start both
    // shutdowns before awaiting either so a slow MP4 finalization does not leave the
    // preview encoder alive unnecessarily.
    const closeConnection = this.closeConnection(deviceId)
    const stopRecording = this.screenRecorder.stop(deviceId)
    this.orientations.delete(deviceId)
    const [, recording] = await Promise.allSettled([closeConnection, stopRecording])
    if (recording.status === 'rejected') {
      log.warn('[android] could not finalize recording while releasing device', deviceId, recording.reason)
    }
  }

  isRecording(deviceId: string): boolean {
    return this.screenRecorder.isRecording(deviceId)
  }

  async startRecording(deviceId: string, captureRoot: string): Promise<DeviceCapture> {
    const serial = this.serialFor(deviceId)
    if (!serial) throw new Error(`${deviceId} is not a running Android device.`)
    if (!this.owners.has(deviceId)) throw new Error(`${deviceId} is not bound to a session.`)
    const descriptor = this.descriptorFor(deviceId)
    return this.screenRecorder.start({
      deviceId,
      serial,
      deviceName: descriptor?.name ?? 'android',
      captureRoot,
      ...(descriptor?.versionRank ? { apiLevel: descriptor.versionRank } : {}),
    })
  }

  stopRecording(deviceId: string): Promise<DeviceCapture | null> {
    return this.screenRecorder.stop(deviceId)
  }

  /**
   * Start an AVD and work out which serial it landed on.
   *
   * The search is the point: `emulator -avd` does not report its port, so the only way
   * to know is to watch adb for a serial that was not there before and ask it its
   * name. Serials are also reused — an emulator that just died frees 5554 for the next
   * one — so matching on the AVD name rather than on "a serial I had not seen" is what
   * keeps this from binding to the wrong device.
   */
  private async launchAndFind(avdId: string, signal?: AbortSignal): Promise<string | null> {
    const launch = this.toolchain.avd.launch(avdId)
    this.launched.set(avdId, launch)
    let exited = false
    void launch.exited.then(() => { exited = true })

    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) break
      if (exited) {
        log.warn('[android] emulator exited before it reached adb', avdId)
        return null
      }
      const attached = await this.toolchain.adb.devices(signal).catch(() => [])
      for (const device of attached) {
        if (device.state !== 'device' && device.state !== 'offline') continue
        const name = await this.avdNameOf(device.serial).catch(() => null)
        if (name === avdId) return device.serial
      }
      await delay(BOOT_POLL_MS, signal)
    }
    log.warn('[android] emulator never appeared on adb', avdId)
    return null
  }

  /** Wait until the device has finished booting, not merely until adb can see it. */
  private async waitForBoot(serial: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) return
      const ready = await this.toolchain.adb
        .getProp(serial, 'sys.boot_completed')
        .catch(() => '')
      // The property is absent, then "", then "1". Anything else means still booting —
      // and `adb wait-for-device` returns long before this does, which is exactly the
      // trap: the device answers while its UI does not yet exist.
      if (ready.trim() === '1') return
      await delay(BOOT_POLL_MS, signal)
    }
  }

  /** Shut down only the emulators this app started. */
  async dispose(): Promise<void> {
    await this.screenRecorder.stopAll()
    await Promise.all([...this.connections.keys()].map((id) => this.closeConnection(id)))
    for (const launch of this.launched.values()) launch.stop()
    this.launched.clear()
    this.owners.clear()
    this.serials.clear()
  }
}

/** `android:avd:Medium_Phone_API_36.1` -> `Medium_Phone_API_36.1`. */
export function avdIdFromDeviceId(deviceId: string): string | null {
  const match = /^android:avd:(.+)$/.exec(deviceId)
  return match ? match[1]! : null
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
