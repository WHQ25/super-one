import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  IosSimulatorHelperProbe,
  IosSimulatorInput,
  IosSimulatorInputResult,
  IosSimulatorPreviewQuality,
} from '@superone/shared/ios-simulator'
import { IOS_SIMULATOR_PROTOCOL_VERSION } from '@superone/shared/ios-simulator'
import { trace } from '../agent/event-trace'
import { ensureIosSimulatorHelper } from './helper-build'
import { LatestValueQueue } from './latest-value-queue'

const MAX_CONTROL_LINE_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 32 * 1024 * 1024
const FRAME_HEADER_BYTES = 12

export type NativeFrameKind = 'png' | 'h264-config' | 'h264'

export interface NativeFramePacket {
  kind: NativeFrameKind
  keyframe: boolean
  timestampUs: number
  data: Buffer
}

export interface IosSimulatorNativeStreamInfo {
  codec: 'png' | 'h264'
  pixelWidth: number
  pixelHeight: number
  fallbackReason?: string
}

export interface IosSimulatorNativeAttachment {
  udid: string
  pixelWidth: number
  pixelHeight: number
  inputAvailable: boolean
  inputError?: string
  /**
   * Whether this CoreSimulator took the opening hardware-keyboard state. It doubles
   * as the capability flag -- one that accepted it can be toggled, one that refused
   * has no switch to offer -- and it is the only reading there is, because
   * CoreSimulator exposes a setter and no getter.
   */
  keyboardAvailable: boolean
}

export function isCoalescibleTouchUpdate(
  input: IosSimulatorInput,
): input is Extract<IosSimulatorInput, { type: 'touch.update' }> {
  return input.type === 'touch.update'
    && input.contacts.length > 0
    && input.contacts.every((contact) => contact.phase === 'moved')
}

/** The touch fields the trace carries, built once instead of at all three call sites. */
function touchTrace(input: IosSimulatorInput): { phases?: string[]; ids?: number[] } {
  if (input.type !== 'touch.update') return {}
  return { phases: input.contacts.map((c) => c.phase), ids: input.contacts.map((c) => c.id) }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Reassembles the helper's length-prefixed frame records off the socket.
 *
 * Chunks are held in a list and joined once, when a whole record has arrived. The
 * obvious `buffer = concat([buffer, chunk])` per chunk is quadratic in chunk count:
 * a 1MB PNG frame delivered in sixteen 64KB reads copied ~8MB to move 1MB, which at
 * 30fps is a quarter of a gigabyte per second of pure memcpy.
 */
export class NativeFrameParser {
  private pending: Buffer[] = []
  private buffered = 0

  push(chunk: Uint8Array): NativeFramePacket[] {
    // No `Buffer.from` — a socket 'data' chunk is already a Buffer this parser owns.
    this.pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    this.buffered += chunk.byteLength
    const frames: NativeFramePacket[] = []
    while (this.buffered >= 4) {
      const length = this.peek(4).readUInt32LE(0)
      if (length < FRAME_HEADER_BYTES) throw new Error(`Native frame header is invalid (${length} bytes).`)
      if (length > MAX_FRAME_BYTES) throw new Error(`Native frame is too large (${length} bytes).`)
      if (this.buffered < length + 4) break
      const record = this.take(length + 4)
      const kind = record[4] === 1
        ? 'png'
        : record[4] === 2
          ? 'h264-config'
          : record[4] === 3
            ? 'h264'
            : null
      if (!kind) throw new Error(`Native frame kind is invalid (${record[4]}).`)
      frames.push({
        kind,
        keyframe: (record[5] & 1) !== 0,
        timestampUs: Number(record.readBigUInt64LE(8)),
        data: record.subarray(4 + FRAME_HEADER_BYTES),
      })
    }
    return frames
  }

  /** The first `count` buffered bytes, without consuming them. Copies only if split. */
  private peek(count: number): Buffer {
    const first = this.pending[0]!
    if (first.length >= count) return first
    return this.join(count, false)
  }

  /**
   * Consumes and returns the first `count` bytes as one buffer.
   *
   * Always `allocUnsafeSlow`, never the pool: `emitFrame` sends a view over this
   * record across the MessagePort, and structured clone copies a view's WHOLE
   * backing ArrayBuffer — a pooled record would ship the entire 8KB slab, adjacent
   * frames' bytes included.
   */
  private take(count: number): Buffer {
    const record = this.join(count, true)
    this.buffered -= count
    return record
  }

  private join(count: number, consume: boolean): Buffer {
    const out = Buffer.allocUnsafeSlow(count)
    let written = 0
    let index = 0
    while (written < count) {
      const chunk = this.pending[index]!
      const take = Math.min(chunk.length, count - written)
      chunk.copy(out, written, 0, take)
      written += take
      // A chunk consumed whole is dropped; one consumed in part keeps its remainder
      // in place, so the next record starts exactly where this one stopped.
      if (take === chunk.length) index += 1
      else if (consume) this.pending[index] = chunk.subarray(take)
    }
    if (consume) this.pending = this.pending.slice(index)
    return out
  }
}

function runProbe(binary: string): Promise<IosSimulatorHelperProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--probe'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) { reject(new Error(stderr.trim() || `iOS helper exited with code ${code}.`)); return }
      try {
        const probe = JSON.parse(stdout.trim()) as IosSimulatorHelperProbe
        if (probe.protocolVersion !== IOS_SIMULATOR_PROTOCOL_VERSION) {
          reject(new Error(`Unsupported iOS helper protocol ${probe.protocolVersion}.`))
          return
        }
        resolve(probe)
      } catch (error) {
        reject(new Error(`Invalid iOS helper probe: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

export async function probeIosSimulatorHelper(cacheRoot: string): Promise<IosSimulatorHelperProbe | null> {
  if (process.platform !== 'darwin') return null
  return runProbe(await ensureIosSimulatorHelper(cacheRoot))
}

export class IosSimulatorHelperRuntime {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private frameServer: Server | null = null
  private frameSocket: Socket | null = null
  private frameDirectory: string | null = null
  private frameParser = new NativeFrameParser()
  private attached: IosSimulatorNativeAttachment | null = null
  private negotiatedStream: IosSimulatorNativeStreamInfo | null = null
  private disposed = false
  /**
   * Set once the helper process has gone away on its own. A crashed runtime is not
   * reusable: `attach` and `stream.start` are per-process state, so a lazily
   * restarted child would answer every request from a device it never attached to.
   */
  private crashed = false
  private readonly touchUpdates = new LatestValueQueue<
    Extract<IosSimulatorInput, { type: 'touch.update' }>,
    IosSimulatorInputResult
  >((input) => this.sendInputNow(input))

  constructor(private readonly binary: string) {}

  get attachment(): IosSimulatorNativeAttachment | null { return this.attached }

  /**
   * What the helper actually negotiated, which is not the attachment size once the
   * preview is scaled down. This is the size the decoder has to be configured with.
   */
  get streamInfo(): IosSimulatorNativeStreamInfo | null { return this.negotiatedStream }

  /** False once this runtime can no longer be trusted, so the owner rebuilds it. */
  get alive(): boolean { return !this.disposed && !this.crashed }

  private start(): void {
    if (this.process) return
    const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4096)
    })
    // EPIPE lands on the stdin stream, not on the child. Unhandled it is an
    // uncaught exception in main, and a helper that dies between `start()` and the
    // write below is exactly when it fires. `exit` already fails the pending map.
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => {
      this.crashed = true
      this.failAll(error)
    })
    child.on('exit', (code, signal) => {
      this.process = null
      this.attached = null
      this.crashed = true
      this.failAll(new Error(
        `iOS helper exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : ''}`,
      ))
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    if (this.stdoutBuffer.length > MAX_CONTROL_LINE_BYTES) {
      this.failAll(new Error('iOS helper control response exceeded its size limit.'))
      return
    }
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.consumeLine(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private consumeLine(line: string): void {
    let value: Record<string, unknown>
    try { value = JSON.parse(line) as Record<string, unknown> } catch { return }
    if (value.event === 'ready') {
      if (value.protocolVersion !== IOS_SIMULATOR_PROTOCOL_VERSION) {
        this.failAll(new Error(`Unsupported iOS helper protocol ${String(value.protocolVersion)}.`))
      }
      return
    }
    if (typeof value.id !== 'number') return
    const pending = this.pending.get(value.id)
    if (!pending) return
    this.pending.delete(value.id)
    clearTimeout(pending.timer)
    if (value.ok === true) pending.resolve(value.result)
    else pending.reject(new Error(typeof value.error === 'string' ? value.error : 'iOS helper request failed.'))
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('iOS helper runtime is disposed.'))
    // Rejecting rather than silently respawning: the caller owns the rebuild, and a
    // fresh child would take input for a device nobody attached it to.
    if (this.crashed) return Promise.reject(new Error('iOS helper runtime exited.'))
    this.start()
    const child = this.process
    if (!child) return Promise.reject(new Error('iOS helper did not start.'))
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`iOS helper request ${method} timed out.`))
      }, 15_000)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async attach(udid: string): Promise<IosSimulatorNativeAttachment> {
    const result = await this.request('attach', { udid }) as Record<string, unknown>
    const attachment: IosSimulatorNativeAttachment = {
      udid,
      pixelWidth: Number(result.pixelWidth) || 0,
      pixelHeight: Number(result.pixelHeight) || 0,
      inputAvailable: result.inputAvailable === true,
      keyboardAvailable: result.keyboardAvailable === true,
      ...(typeof result.inputError === 'string' ? { inputError: result.inputError } : {}),
    }
    this.attached = attachment
    return attachment
  }

  async startFrames(
    preferredMode: 'native-framebuffer' | 'native-h264',
    quality: IosSimulatorPreviewQuality,
    onFrame: (frame: NativeFramePacket) => void,
  ): Promise<IosSimulatorNativeStreamInfo> {
    await this.closeFrames()
    const directory = await mkdtemp(join(tmpdir(), 'superone-ios-frames-'))
    const socketPath = join(directory, 'frames.sock')
    const queuedFrames: NativeFramePacket[] = []
    let started = false
    const server = createServer((socket) => {
      this.frameSocket?.destroy()
      this.frameSocket = socket
      this.frameParser = new NativeFrameParser()
      socket.on('data', (chunk) => {
        try {
          for (const frame of this.frameParser.push(chunk)) {
            if (started) onFrame(frame)
            else queuedFrames.push(frame)
          }
        } catch { socket.destroy() }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => { server.off('error', reject); resolve() })
    })
    this.frameDirectory = directory
    this.frameServer = server
    try {
      const result = await this.request('stream.start', {
        socketPath,
        preferredCodec: preferredMode === 'native-h264' ? 'h264' : 'png',
        maxFrameRate: quality.maxFrameRate,
        scale: quality.scale,
      }) as Record<string, unknown>
      const info: IosSimulatorNativeStreamInfo = {
        codec: result.codec === 'h264' ? 'h264' : 'png',
        pixelWidth: Number(result.pixelWidth) || this.attached?.pixelWidth || 0,
        pixelHeight: Number(result.pixelHeight) || this.attached?.pixelHeight || 0,
        ...(typeof result.fallbackReason === 'string'
          ? { fallbackReason: result.fallbackReason }
          : {}),
      }
      // Published before the flush: a config frame can be queued from the
      // synchronous first capture inside the helper's own `stream.start`, and it is
      // the frame that has to carry the negotiated size.
      this.negotiatedStream = info
      started = true
      for (const frame of queuedFrames) onFrame(frame)
      return info
    } catch (error) {
      await this.closeFrames()
      throw error
    }
  }

  async input(input: IosSimulatorInput): Promise<IosSimulatorInputResult> {
    trace('ios.helper', `in:${input.type}`, touchTrace(input))
    if (isCoalescibleTouchUpdate(input)) return this.touchUpdates.enqueue(input)
    if (input.type.startsWith('touch.')) await this.touchUpdates.flush()
    return this.sendInputNow(input)
  }

  private async sendInputNow(input: IosSimulatorInput): Promise<IosSimulatorInputResult> {
    const startedAt = Date.now()
    try {
      const method = input.type
      const result = await this.request(method, input) as Record<string, unknown>
      trace('ios.helper', input.type, {
        ms: Date.now() - startedAt,
        ...touchTrace(input),
        // Samples the queue threw away since the last send: the gap between what
        // the renderer produced and what the device actually received.
        dropped: this.touchUpdates.takeDroppedCount(),
      })
      return {
        ok: true,
        ...(typeof result.skippedCharacters === 'number'
          ? { skippedCharacters: result.skippedCharacters }
          : {}),
      }
    } catch (error) {
      trace('ios.helper', `${input.type}.error`, {
        ms: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : String(error),
        ...touchTrace(input),
      })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async closeFrames(): Promise<void> {
    this.negotiatedStream = null
    if (this.frameServer && this.process) {
      await this.request('stream.stop').catch(() => undefined)
    }
    this.frameSocket?.destroy()
    this.frameSocket = null
    await new Promise<void>((resolve) => {
      if (!this.frameServer) { resolve(); return }
      this.frameServer.close(() => resolve())
    })
    this.frameServer = null
    if (this.frameDirectory) await rm(this.frameDirectory, { recursive: true, force: true })
    this.frameDirectory = null
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.closeFrames()
    this.disposed = true
    const child = this.process
    this.process = null
    child?.stdin.end()
    child?.kill('SIGTERM')
    this.failAll(new Error('iOS helper runtime disposed.'))
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export async function createIosSimulatorHelperRuntime(cacheRoot: string): Promise<IosSimulatorHelperRuntime> {
  return new IosSimulatorHelperRuntime(await ensureIosSimulatorHelper(cacheRoot))
}
