/**
 * Getting scrcpy's server onto a device and talking to it.
 *
 * The transport for everything Android: the video the user watches and the touches the
 * agent sends both ride these two sockets. It is the counterpart to the Swift helper
 * on the iOS side, with the crucial difference that this one is not ours — it is a
 * pinned build of a third-party server, so the contract is a wire protocol rather than
 * a compile.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from '../../logger'
import type { Adb } from './adb'
import {
  readStreamHeader,
  ScrcpyPacketParser,
  SCRCPY_DEVICE_PATH,
  SCRCPY_SERVER_SHA256,
  SCRCPY_SERVER_VERSION,
  type ScrcpyMediaPacket,
  type ScrcpySessionPacket,
} from './scrcpy-protocol'

const JAR_NAME = `scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`

/**
 * The vendored jar.
 *
 * Shipped in `extraResources` rather than downloaded, so a first run works offline and
 * the version can never drift from the protocol implemented beside it — client and
 * server versions must match exactly, and scrcpy enforces that on startup.
 */
export function scrcpyServerPath(): string | null {
  const devRoot = fileURLToPath(new URL('../../../../resources/scrcpy', import.meta.url))
  const candidates = [
    process.env.SUPERONE_SCRCPY_SERVER,
    process.resourcesPath ? join(process.resourcesPath, 'scrcpy', JAR_NAME) : undefined,
    join(devRoot, JAR_NAME),
    join(process.cwd(), 'resources/scrcpy', JAR_NAME),
    join(process.cwd(), 'apps/desktop/resources/scrcpy', JAR_NAME),
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Refuse to push a jar that is not the one this code was written against.
 *
 * Cheap insurance against a partially-written file or a substituted resource: this
 * code runs arbitrary bytes on the user's device through `app_process`, and the
 * failure mode of a mismatched build is a protocol that decodes into garbage rather
 * than an error.
 */
export function verifyScrcpyServer(path: string): boolean {
  try {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest === SCRCPY_SERVER_SHA256) return true
    log.error('[scrcpy] server jar digest mismatch', { expected: SCRCPY_SERVER_SHA256, actual: digest })
    return false
  } catch (error) {
    log.error('[scrcpy] server jar unreadable', error)
    return false
  }
}

/**
 * A connection id, as a hex string the server can parse.
 *
 * Must fit a SIGNED 32-bit int: the server does `Integer.parseInt(scid, 16)`, so
 * anything with the top bit set — `deadbeef`, say — throws NumberFormatException and
 * the process aborts before it opens a socket. Learned by watching it happen.
 */
export function newScrcpyScid(random: () => number = Math.random): string {
  const value = Math.floor(random() * 0x7fff_ffff)
  return value.toString(16).padStart(8, '0')
}

export interface ScrcpyConnectionOptions {
  adb: Adb
  /** Path to the adb binary, for the long-lived server process. */
  adbBinary: string
  serial: string
  /** Longest edge of the encoded video. Smaller is cheaper; the tree is unaffected. */
  maxSize?: number
  maxFps?: number
  /** Every line the server writes. The only window into a failure on the device. */
  onServerLog?: (line: string) => void
  signal?: AbortSignal
}

export interface ScrcpyConnection {
  deviceName: string
  /** Current capture geometry. Changes when the device rotates. */
  readonly screen: { width: number; height: number }
  /**
   * Why this device is refusing everything sent on the control socket, if it is.
   *
   * Null on a device that takes input, which is nearly all of them. `send` cannot
   * report a failure — it writes to a socket the server reads at its leisure, and a
   * refusal happens on the far side, minutes of user confusion later. The server does
   * say so in its log, so that is where this is read from, and it is the ONLY signal
   * there is: a phone that will not accept an injected touch behaves exactly like a
   * phone whose screen has nothing to tap.
   */
  readonly controlFault: string | null
  onMedia(listener: (packet: ScrcpyMediaPacket) => void): () => void
  /** Rotation, and the opening geometry. See `ScrcpySessionPacket`. */
  onSession(listener: (session: ScrcpySessionPacket) => void): () => void
  onClosed(listener: (reason: string) => void): () => void
  send(messages: Buffer | readonly Buffer[]): void
  close(): Promise<void>
}

const CONNECT_ATTEMPTS = 40
const CONNECT_INTERVAL_MS = 150
const READY_TIMEOUT_MS = 15_000
/** How long one connected socket gets to produce its preamble before it is retried. */
const HEADER_TIMEOUT_MS = 2_000
/** Long enough for adb to drop a connection the server was not listening for. */
const SETTLE_CONNECT_MS = 40
/** How long the opening geometry gets to arrive before the connection is used anyway. */
const SESSION_TIMEOUT_MS = 3_000

/**
 * Push the server, start it, and open both sockets.
 *
 * The jar is pushed on EVERY connection, not once. `/data/local/tmp` is not durable
 * storage — a jar pushed there was gone minutes later on this machine, and the only
 * symptom is `ClassNotFoundException` inside an abort. scrcpy itself pushes every
 * time for the same reason.
 */
export async function connectScrcpy(options: ScrcpyConnectionOptions): Promise<ScrcpyConnection> {
  const { adb, serial } = options
  const jar = scrcpyServerPath()
  if (!jar) throw new Error('The scrcpy server is missing from this build.')
  if (!verifyScrcpyServer(jar)) throw new Error('The scrcpy server failed its integrity check.')

  await adb.push(serial, jar, SCRCPY_DEVICE_PATH, options.signal)

  const scid = newScrcpyScid()
  const localPort = await adb.forward(serial, `localabstract:scrcpy_${scid}`, options.signal)
  options.onServerLog?.(`[host] scid=${scid} localPort=${localPort} jar=${jar}`)

  let child: ChildProcess | null = null
  const sockets: Socket[] = []
  const mediaListeners = new Set<(packet: ScrcpyMediaPacket) => void>()
  /**
   * Media packets that arrived before anyone was listening.
   *
   * There is always a gap: this function does not hand the connection over until the
   * opening session packet has arrived, and the config packet carrying the stream's
   * parameter sets is written moments after — sometimes in the same TCP read as the
   * preamble. Dropped, it leaves the caller with a decoder it can never configure and
   * a picture that never appears, because scrcpy states the parameter sets exactly
   * once per connection.
   *
   * Bounded by that same handover, which happens within a microtask of this function
   * returning. Null once the first listener has drained it; live from then on.
   */
  let backlog: ScrcpyMediaPacket[] | null = []
  const sessionListeners = new Set<(session: ScrcpySessionPacket) => void>()
  const closedListeners = new Set<(reason: string) => void>()
  const screen = { width: 0, height: 0 }
  let controlFault: string | null = null
  let closed = false

  const cleanup = async (reason: string) => {
    if (closed) return
    closed = true
    for (const socket of sockets) socket.destroy()
    child?.kill('SIGKILL')
    await adb.removeForward(serial, localPort)
    for (const listener of closedListeners) listener(reason)
  }

  try {
    child = startServer(options.adbBinary, serial, scid, options)
    const watchLog = (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim()
      if (!line) return
      log.info('[scrcpy]', line)
      controlFault ??= faultFromServerLog(line)
      options.onServerLog?.(line)
    }
    child.stdout?.on('data', watchLog)
    child.stderr?.on('data', watchLog)
    await waitForServerReady(child, options.signal)

    const opened = await openVideoSocket(localPort, options.onServerLog)
    const video = opened.socket
    const control = opened.control
    sockets.push(video, control)

    const header = opened.header
    const parser = new ScrcpyPacketParser()
    const consume = (chunk: Buffer) => {
      for (const packet of parser.push(chunk)) {
        if (packet.kind === 'session') {
          screen.width = packet.width
          screen.height = packet.height
          for (const listener of sessionListeners) listener(packet)
        } else if (backlog) {
          backlog.push(packet)
        } else {
          for (const listener of mediaListeners) listener(packet)
        }
      }
    }
    // The bytes that shared a read with the preamble go through the parser first, in
    // the order they arrived. See `readHeader` for why they come back by hand.
    if (header.rest.length) consume(header.rest)
    video.on('data', consume)
    // Explicit, because `readHeader` paused the socket and attaching a `data` listener
    // does NOT undo that: Node only auto-resumes when flowing is not already false, so
    // a stream paused by hand stays paused and delivers nothing, forever, in silence.
    video.resume()
    video.on('close', () => void cleanup('The video stream closed.'))
    video.on('error', (error) => void cleanup(`The video stream failed: ${error.message}`))
    control.on('error', (error) => log.warn('[scrcpy] control socket error', error))
    child.on('close', () => void cleanup('The scrcpy server exited.'))

    // Wait for the opening session packet before handing the connection over. It
    // arrives a beat after the header, and returning early hands the caller a
    // connection whose `screen` reads 0x0 — a shape nothing can do anything sensible
    // with, and one that silently becomes correct a moment later.
    await new Promise<void>((resolve) => {
      if (screen.width > 0) {
        resolve()
        return
      }
      const done = () => {
        clearTimeout(timer)
        sessionListeners.delete(done)
        resolve()
      }
      // Resolves either way: a device that never sends one is still usable through
      // adb, and the caller can read the geometry from a screenshot instead.
      const timer = setTimeout(done, SESSION_TIMEOUT_MS)
      sessionListeners.add(done)
    })

    return {
      deviceName: header.deviceName,
      get screen() { return screen },
      get controlFault() { return controlFault },
      onMedia: (listener) => {
        mediaListeners.add(listener)
        if (backlog) {
          const held = backlog
          backlog = null
          for (const packet of held) listener(packet)
        }
        return () => mediaListeners.delete(listener)
      },
      onSession: (listener) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
      onClosed: (listener) => { closedListeners.add(listener); return () => closedListeners.delete(listener) },
      send: (messages) => {
        if (closed) return
        for (const message of Array.isArray(messages) ? messages : [messages as Buffer]) {
          control.write(message)
        }
      },
      close: () => cleanup('Closed by the host.'),
    }
  } catch (error) {
    await cleanup('Failed to connect.')
    throw error
  }
}

/**
 * Read a server log line as a reason the control socket will never work.
 *
 * Only the one condition, because only one of them is silent AND recoverable by the
 * user. A phone that denies `INJECT_EVENTS` to the shell user accepts the connection,
 * accepts every control message written to it, and does nothing with any of them —
 * so from the host the device simply looks unresponsive, and the person tapping it
 * has no way to learn that a switch on the phone is what stands in the way. Xiaomi,
 * Redmi and POCO ship with that switch off; the server's own advice names it.
 */
export function faultFromServerLog(line: string): string | null {
  if (!line.includes('INJECT_EVENTS')) return null
  return 'This phone is refusing injected input. Turn on "USB debugging (Security settings)" '
    + 'in Developer options and restart it — Xiaomi, Redmi and POCO devices ship with that '
    + 'switch off, and nothing can touch the screen until it is on.'
}

function startServer(
  adbBinary: string,
  serial: string,
  scid: string,
  options: ScrcpyConnectionOptions,
): ChildProcess {
  const args = [
    '-s', serial, 'shell',
    `CLASSPATH=${SCRCPY_DEVICE_PATH}`,
    'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_SERVER_VERSION,
    `scid=${scid}`,
    'log_level=info',
    // No audio: nothing in this app plays it, and the extra socket is one more thing
    // to fail during startup.
    'audio=false',
    'control=true',
    'tunnel_forward=true',
    'video_codec=h264',
    // A keyframe every second, instead of whenever the encoder feels like one.
    //
    // Left to itself this phone went 26 SECONDS between them, and every path that
    // recovers from a lost decoder waits for the next one: a viewer joining an open
    // connection, a decoder rebuilt after a resize, and — the one that hurts — a
    // renderer that fell behind and dropped to the next random-access point. Over
    // wireless adb that last case fires roughly once a minute, and a 26-second freeze
    // is indistinguishable from a dead preview.
    //
    // Asked as a codec option because scrcpy has no flag for it; the encoder treats
    // it as a floor and lands nearer 2.5s on a static screen. Measured cost on this
    // device: 414 -> 682 kbps, which is nothing next to what the link carries.
    'video_codec_options=i-frame-interval:int=1',
    ...(options.maxSize ? [`max_size=${options.maxSize}`] : []),
    ...(options.maxFps ? [`max_fps=${options.maxFps}`] : []),
  ]
  // Spawned through the adb binary directly rather than the Adb wrapper: this process
  // is meant to stay alive for the whole session, while every method there waits for
  // an exit.
  //
  // stdin is a PIPE and is deliberately left open. `adb shell` forwards the end of its
  // own stdin to the device as EOF, and the server treats that as a shutdown — so
  // `stdio: ['ignore', …]` starts a server that announces the device and then exits
  // before it ever listens, which looks from here like a socket that connects and
  // instantly closes.
  return spawn(adbBinary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
}

/**
 * Wait for the server to announce the device, which is when it starts listening.
 *
 * Connecting before that races the socket into existence, and adb answers a forward to
 * a socket nobody is listening on by accepting and immediately closing — which reads
 * as a successful connection followed by an inexplicable EOF.
 */
function waitForServerReady(child: ChildProcess, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(
      () => finish(new Error('The scrcpy server did not start in time.')),
      READY_TIMEOUT_MS,
    )
    const watch = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (text.includes('Device:')) finish()
      // The server reports its own failures on stdout before exiting; surfacing them
      // is the difference between a diagnosable error and a silent timeout.
      if (/ERROR|Exception/.test(text)) finish(new Error(text.trim().split('\n')[0]))
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)
    child.on('close', () => finish(new Error('The scrcpy server exited during startup.')))
    signal?.addEventListener('abort', () => finish(new Error('Cancelled.')), { once: true })
  })
}

/**
 * Open both sockets and read the preamble, retrying the three together.
 *
 * The order is a protocol requirement, not a preference: the server does not send the
 * video header until BOTH the video and the control socket have connected. Connecting
 * video, reading its header, and only then connecting control is a deadlock — measured
 * as a connection that stays open for exactly the header timeout and delivers nothing,
 * while the server sits waiting for the socket that is waiting for it.
 *
 * Connecting is also not evidence the server is ready. `adb forward` aimed at a
 * localabstract socket nobody is listening on ACCEPTS the TCP connection and then
 * immediately closes it, so an early attempt reports success and hands back a socket
 * that dies a moment later. The server prints "Device: …" slightly before it starts
 * listening, so waiting for that line does not cover it either.
 *
 * Hence the pause after the video socket connects: if adb was going to drop it, it
 * already has, and finding out BEFORE connecting control is what keeps a doomed
 * attempt from making the next connection land in the video slot instead.
 */
async function openVideoSocket(
  port: number,
  onLog?: (line: string) => void,
): Promise<{
  socket: Socket
  control: Socket
  header: { deviceName: string; codec: string; rest: Buffer }
}> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    const video = await openSocket(port, 'video').catch((error: unknown) => {
      lastError = error
      return null
    })
    if (video) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_CONNECT_MS))
      if (video.destroyed) {
        onLog?.(`[scrcpy] attempt ${attempt}: server not listening yet`)
      } else {
        const control = await openSocket(port, 'control').catch((error: unknown) => {
          lastError = error
          return null
        })
        if (control) {
          const header = await readHeader(video).catch((error: unknown) => {
            lastError = error
            return null
          })
          if (header) return { socket: video, control, header }
          control.destroy()
        }
        video.destroy()
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CONNECT_INTERVAL_MS))
  }
  throw new Error(
    `The scrcpy video stream never started: ${lastError instanceof Error ? lastError.message : 'no header'}`,
  )
}

/**
 * One TCP connection attempt, with `attempts` retries on refusal.
 *
 * Kept to a single attempt by default: for the video socket, "connected" is not the
 * success condition — see `openVideoSocket` — so retrying in here would only multiply
 * out against the retries that actually matter.
 */
function openSocket(port: number, label: string, attempts = 1): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (remaining: number) => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.setNoDelay(true)
        resolve(socket)
      })
      socket.once('error', () => {
        socket.destroy()
        if (remaining > 0) setTimeout(() => attempt(remaining - 1), CONNECT_INTERVAL_MS)
        else reject(new Error(`The scrcpy ${label} socket never opened.`))
      })
    }
    attempt(attempts - 1)
  })
}

/**
 * Read the preamble off the video socket, and hand back whatever came in behind it.
 *
 * The leftover is RETURNED rather than pushed back into the socket. `unshift` looks
 * like the natural move and is a trap: a stream stays in flowing mode after its last
 * `data` listener is removed, and `unshift` on a flowing stream with an empty buffer
 * re-emits synchronously — to nobody. The bytes vanish. They are also the worst ones
 * to lose, because the config packet carrying the stream's parameter sets is the first
 * thing the server writes after the preamble, and scrcpy never sends it twice.
 *
 * Whether it happens at all is down to whether one TCP read carried both, which is a
 * question about the transport rather than about this code — a local emulator socket
 * usually delivers the preamble alone, a phone over wireless adb has every reason not
 * to.
 */
function readHeader(socket: Socket): Promise<{ deviceName: string; codec: string; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    // A socket that connects and then says nothing has to fail rather than hang: adb
    // will happily hold one open against a server that is not listening.
    const timer = setTimeout(() => {
      socket.off('data', onData)
      reject(new Error('The video socket sent no header.'))
    }, HEADER_TIMEOUT_MS)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const header = readStreamHeader(buffer)
      if (!header) return
      clearTimeout(timer)
      socket.off('data', onData)
      // Stopped, not merely unlistened: removing the last `data` listener does NOT
      // take a stream out of flowing mode, and a flowing stream with nothing on it
      // drops what it emits. The caller's listener resumes it.
      socket.pause()
      resolve({
        deviceName: header.deviceName,
        codec: header.codec,
        rest: buffer.subarray(header.consumed),
      })
    }
    socket.on('data', onData)
    socket.once('error', reject)
    socket.once('close', () => reject(new Error('The video socket closed before its header arrived.')))
  })
}
