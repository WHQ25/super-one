import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  ANDROID_LEGACY_SCREEN_RECORDING_LIMIT_SECONDS,
  ANDROID_UNLIMITED_SCREEN_RECORDING_API_LEVEL,
  type DeviceCapture,
} from '@superone/shared/device'
import { captureFileName } from '../capture-path'
import type { Adb } from './adb'

const STARTUP_GRACE_MS = 500
const STOP_TIMEOUT_MS = 10_000
const FORCE_STOP_TIMEOUT_MS = 2_000
const FILE_SETTLE_ATTEMPTS = 10
const FILE_SETTLE_POLL_MS = 200
const REMOTE_CAPTURE_ROOT = '/data/local/tmp'

export interface AndroidScreenrecordExit {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
}

/** One long-lived `adb shell screenrecord` command. */
export interface AndroidScreenrecordProcess {
  /** Resolves once screenrecord has survived startup long enough to be usable. */
  ready: Promise<void>
  exited: Promise<AndroidScreenrecordExit>
  /** Disconnect adb so Android delivers SIGHUP and screenrecord finalizes its MP4. */
  interrupt(): void
  /** Last-resort host cleanup after graceful shutdown times out. */
  forceStop(): void
}

export type SpawnAndroidScreenrecord = (
  adbBinary: string,
  serial: string,
  remotePath: string,
  timeLimitSeconds: number,
) => AndroidScreenrecordProcess

/**
 * Start Android's platform recorder through one persistent adb transport.
 *
 * `screenrecord` handles both SIGINT and SIGHUP. Sending SIGINT to the host adb
 * either forwards the interruption or closes the transport, which produces SIGHUP
 * on the device. Both paths let MediaMuxer write the MP4 trailer before we pull it.
 */
export const spawnAndroidScreenrecord: SpawnAndroidScreenrecord = (
  adbBinary,
  serial,
  remotePath,
  timeLimitSeconds,
) => {
  const child = spawn(adbBinary, [
    '-s', serial,
    'shell',
    'screenrecord',
    '--verbose',
    '--time-limit', String(timeLimitSeconds),
    remotePath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  let readySettled = false
  let exitSettled = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveExit!: (exit: AndroidScreenrecordExit) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const exited = new Promise<AndroidScreenrecordExit>((resolve) => { resolveExit = resolve })
  const startupTimer = setTimeout(() => {
    if (readySettled) return
    readySettled = true
    resolveReady()
  }, STARTUP_GRACE_MS)

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
    // AOSP prints this only after the encoder and virtual display are configured.
    // Keep the grace timer as a compatibility fallback for vendor implementations
    // whose verbose wording differs.
    if (!readySettled && /Content area is|Recording started/i.test(stderr)) {
      readySettled = true
      clearTimeout(startupTimer)
      resolveReady()
    }
  })

  const finish = (exit: AndroidScreenrecordExit) => {
    if (exitSettled) return
    exitSettled = true
    clearTimeout(startupTimer)
    if (!readySettled) {
      readySettled = true
      rejectReady(new Error(
        `Android screen recording failed to start: ${exit.stderr.trim() || `exit ${exit.code ?? -1}`}`,
      ))
    }
    resolveExit(exit)
  }
  child.once('error', (error) => {
    finish({ code: null, signal: null, stderr: `${stderr}${error.message}` })
  })
  child.once('close', (code, signal) => { finish({ code, signal, stderr }) })

  return {
    ready,
    exited,
    interrupt: () => {
      if (exitSettled) return
      child.kill('SIGINT')
    },
    forceStop: () => {
      if (exitSettled) return
      child.kill('SIGKILL')
    },
  }
}

interface AndroidRecordingSession {
  serial: string
  remotePath: string
  capture: DeviceCapture
  flight: Promise<AndroidScreenrecordProcess>
}

export interface AndroidRecordingTarget {
  deviceId: string
  serial: string
  deviceName: string
  captureRoot: string
  apiLevel?: number
}

/** Device-keyed recording ownership shared by every Android surface. */
export class AndroidScreenRecorder {
  private readonly sessions = new Map<string, AndroidRecordingSession>()

  constructor(
    private readonly adb: Adb,
    private readonly adbBinary: string,
    private readonly spawnRecording: SpawnAndroidScreenrecord = spawnAndroidScreenrecord,
  ) {}

  isRecording(deviceId: string): boolean {
    return this.sessions.has(deviceId)
  }

  async start(target: AndroidRecordingTarget): Promise<DeviceCapture> {
    if (this.sessions.has(target.deviceId)) {
      throw new Error('This Android device is already recording.')
    }
    const fileName = captureFileName(target.deviceName || 'android', 'mp4', new Date())
    const path = join(target.captureRoot, encodeURIComponent(target.deviceId), fileName)
    // Always a DEVICE path, including when the desktop host is Windows.
    const remotePath = posix.join(REMOTE_CAPTURE_ROOT, `superone-screenrecord-${randomUUID()}.mp4`)
    const capture: DeviceCapture = { path, fileName, kind: 'recording' }
    // Android 14 removed screenrecord's historical three-minute ceiling. `0` means
    // unlimited there; legacy releases reject zero, so keep their documented cap.
    const timeLimitSeconds = (target.apiLevel ?? 0) >= ANDROID_UNLIMITED_SCREEN_RECORDING_API_LEVEL
      ? 0
      : ANDROID_LEGACY_SCREEN_RECORDING_LIMIT_SECONDS
    const processRef: { current: AndroidScreenrecordProcess | null } = { current: null }
    // Register the whole setup flight before its first await. A panel closing while
    // mkdir is pending must still find and stop this recording, and two concurrent
    // start calls must not launch two encoders on the same device.
    const flight = (async () => {
      await mkdir(dirname(path), { recursive: true })
      const process = this.spawnRecording(
        this.adbBinary,
        target.serial,
        remotePath,
        timeLimitSeconds,
      )
      processRef.current = process
      await process.ready
      return process
    })()
    const session: AndroidRecordingSession = {
      serial: target.serial,
      remotePath,
      capture,
      flight,
    }
    this.sessions.set(target.deviceId, session)
    try {
      await flight
      return capture
    } catch (error) {
      if (this.sessions.get(target.deviceId) === session) this.sessions.delete(target.deviceId)
      processRef.current?.forceStop()
      await this.removeRemote(target.serial, remotePath)
      throw error
    }
  }

  async stop(deviceId: string): Promise<DeviceCapture | null> {
    const current = this.sessions.get(deviceId)
    if (!current) return null
    // Delete before awaiting so two stop callers cannot both pull and remove the same
    // device-side file. A stop racing startup still waits for the shared flight.
    this.sessions.delete(deviceId)
    const process = await current.flight.catch(() => null)
    if (!process) return null

    try {
      process.interrupt()
      if (!await settlesWithin(process.exited, STOP_TIMEOUT_MS)) {
        process.forceStop()
        if (!await settlesWithin(process.exited, FORCE_STOP_TIMEOUT_MS)) {
          throw new Error('Android screen recording did not stop after adb was terminated.')
        }
      }

      const finalized = await this.waitForRemoteFile(current.serial, current.remotePath)
      if (!finalized) {
        const exit = await process.exited
        throw new Error(
          `Android screen recording produced no finalized MP4: ${exit.stderr.trim() || `exit ${exit.code ?? -1}`}`,
        )
      }
      await this.adb.pull(current.serial, current.remotePath, current.capture.path)
      return current.capture
    } finally {
      await this.removeRemote(current.serial, current.remotePath)
    }
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((deviceId) => this.stop(deviceId)))
  }

  /** Wait for two equal non-zero sizes so MediaMuxer has finished its trailer. */
  private async waitForRemoteFile(serial: string, remotePath: string): Promise<boolean> {
    let previous: number | null = null
    for (let attempt = 0; attempt < FILE_SETTLE_ATTEMPTS; attempt += 1) {
      const output = await this.adb.shell(serial, ['stat', '-c', '%s', remotePath]).catch(() => '')
      const size = Number.parseInt(output.trim(), 10)
      if (Number.isFinite(size) && size > 0 && size === previous) return true
      previous = Number.isFinite(size) && size > 0 ? size : null
      await delay(FILE_SETTLE_POLL_MS)
    }
    return false
  }

  private async removeRemote(serial: string, remotePath: string): Promise<void> {
    await this.adb.shell(serial, ['rm', '-f', remotePath]).catch(() => undefined)
  }
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
  return result
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
