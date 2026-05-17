import { createRequire } from 'node:module'
import type { Terminal as XTermHeadless } from '@xterm/headless'
import type { SerializeAddon as SerializeAddonInstance } from '@xterm/addon-serialize'
import type {
  TerminalEvent,
  TerminalListItem,
  TerminalSnapshot,
  TerminalStatus,
} from '@superone/shared/agent-types'
import type { PtyLike, PtySpawner } from './pty'
import { TerminalOwnership } from './terminal-ownership'

const nodeRequire = createRequire(import.meta.url)
const { Terminal } = nodeRequire('@xterm/headless') as typeof import('@xterm/headless')
const { SerializeAddon } = nodeRequire('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

export interface TerminalSessionOptions {
  terminalId: string
  cwd: string
  title: string
  cols: number
  rows: number
  spawner: PtySpawner
  ownership: TerminalOwnership
  onEvent: (event: TerminalEvent) => void
  env?: Record<string, string>
  shell?: string
  coalesceMs?: number
  snapshotSoftLimit?: number
}

const DEFAULT_COALESCE_MS = 24
const DEFAULT_SNAPSHOT_SOFT_LIMIT = 256 * 1024

export class TerminalSession {
  readonly terminalId: string
  readonly cwd: string
  readonly ownership: TerminalOwnership
  title: string
  lastAnsi = ''

  private readonly pty: PtyLike
  private readonly term: XTermHeadless
  private readonly serializer: SerializeAddonInstance
  private readonly onEvent: (event: TerminalEvent) => void
  private readonly coalesceMs: number
  private readonly snapshotSoftLimit: number

  private _status: TerminalStatus = 'running'
  private _cols: number
  private _rows: number
  private seq = 0
  private buffer = ''
  private bufferFromSeq = 0
  private bufferToSeq = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotting = false
  private deferred: TerminalEvent[] = []

  constructor(opts: TerminalSessionOptions) {
    this.terminalId = opts.terminalId
    this.cwd = opts.cwd
    this.title = opts.title
    this.ownership = opts.ownership
    this.onEvent = opts.onEvent
    this.coalesceMs = opts.coalesceMs ?? DEFAULT_COALESCE_MS
    this.snapshotSoftLimit = opts.snapshotSoftLimit ?? DEFAULT_SNAPSHOT_SOFT_LIMIT
    this._cols = opts.cols
    this._rows = opts.rows

    this.term = new Terminal({ cols: opts.cols, rows: opts.rows, allowProposedApi: true })
    this.serializer = new SerializeAddon()
    this.term.loadAddon(this.serializer as unknown as Parameters<XTermHeadless['loadAddon']>[0])

    this.pty = opts.spawner.spawn({
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
      shell: opts.shell,
    })
    this.pty.onData((data) => this.onPtyData(data))
    this.pty.onExit(({ exitCode, signal }) => this.onPtyExit(exitCode, signal))

    this.ownership.onChange((owner) => {
      this.emit({
        type: 'terminal_owner_changed',
        terminalId: this.terminalId,
        ownerDeviceId: owner.kind === 'remote' ? owner.deviceId : null,
        writableByMe: owner.kind === 'local',
      })
    })
  }

  get status(): TerminalStatus {
    return this._status
  }

  listItem(): TerminalListItem {
    return {
      terminalId: this.terminalId,
      cwd: this.cwd,
      title: this.title,
      status: this._status,
      ownerDeviceId: this.ownership.ownerDeviceId,
    }
  }

  input(data: string): void {
    if (this._status !== 'running') return
    this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return
    this._cols = cols
    this._rows = rows
    this.term.resize(cols, rows)
    if (this._status === 'running') this.pty.resize(cols, rows)
  }

  private composeSnapshotFrames(
    requester: 'local' | string,
    cut: number,
    ansi: string,
  ): { snapshot: TerminalSnapshot; frames: TerminalEvent[] } {
    const snapshot: TerminalSnapshot = {
      terminalId: this.terminalId,
      cwd: this.cwd,
      title: this.title,
      status: this._status,
      cols: this._cols,
      rows: this._rows,
      lastSeq: cut,
      ownerDeviceId: this.ownership.ownerDeviceId,
      writableByMe: this.ownership.isWritableBy(requester),
      subscriberCount: this.ownership.subscriberCount,
    }
    const frames: TerminalEvent[] = []
    if (ansi.length <= this.snapshotSoftLimit) {
      frames.push({ type: 'terminal_snapshot', terminalId: this.terminalId, snapshot, ansi })
    } else {
      const snapshotId = `${this.terminalId}:${cut}:${Date.now()}`
      const total = Math.ceil(ansi.length / this.snapshotSoftLimit)
      for (let i = 0; i < total; i++) {
        frames.push({
          type: 'terminal_snapshot_chunk',
          terminalId: this.terminalId,
          snapshotId,
          index: i,
          total,
          ansi: ansi.slice(i * this.snapshotSoftLimit, (i + 1) * this.snapshotSoftLimit),
          snapshot: i === 0 ? snapshot : undefined,
        })
      }
    }
    return { snapshot, frames }
  }

  async snapshot(requester: 'local' | string): Promise<TerminalSnapshot> {
    const cut = this.seq
    this.flushBuffer(true)
    this.snapshotting = true

    await new Promise<void>((resolve) => this.term.write('', resolve))
    const ansi = this.serializer.serialize()
    this.lastAnsi = ansi

    const { snapshot, frames } = this.composeSnapshotFrames(requester, cut, ansi)
    for (const f of frames) this.rawEmit(f)

    this.snapshotting = false
    const queued = this.deferred
    this.deferred = []
    for (const e of queued) this.rawEmit(e)
    return snapshot
  }

  async snapshotFrames(requester: 'local' | string): Promise<TerminalEvent[]> {
    await new Promise<void>((resolve) => this.term.write('', resolve))
    const cut = this.seq
    const ansi = this.serializer.serialize()
    this.lastAnsi = ansi
    return this.composeSnapshotFrames(requester, cut, ansi).frames
  }

  kill(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this._status === 'running') this.pty.kill()
    this.disposeTerm()
  }

  forceExit(): void {
    if (this._status === 'exited') return
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pty.kill()
    this._status = 'exited'
    this.rawEmit({ type: 'terminal_exited', terminalId: this.terminalId, exitCode: null, signal: null })
    this.disposeTerm()
  }

  private onPtyData(data: string): void {
    this.seq += 1
    this.term.write(data)
    if (this.buffer === '') this.bufferFromSeq = this.seq
    this.bufferToSeq = this.seq
    this.buffer += data
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushBuffer(false), this.coalesceMs)
    }
  }

  private flushBuffer(fromSnapshot: boolean): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.buffer === '') return
    const event: TerminalEvent = {
      type: 'terminal_output',
      terminalId: this.terminalId,
      data: this.buffer,
      fromSeq: this.bufferFromSeq,
      toSeq: this.bufferToSeq,
      createdAt: Date.now(),
    }
    this.buffer = ''
    if (fromSnapshot) this.rawEmit(event)
    else this.emit(event)
  }

  private onPtyExit(exitCode: number, signal: number | null): void {
    this.flushBuffer(false)
    this._status = 'exited'
    this.emit({ type: 'terminal_exited', terminalId: this.terminalId, exitCode, signal })
    this.disposeTerm()
  }

  private disposeTerm(): void {
    try {
      this.term.dispose()
    } catch {
      /* already disposed */
    }
  }

  private emit(event: TerminalEvent): void {
    if (this.snapshotting) {
      this.deferred.push(event)
      return
    }
    this.rawEmit(event)
  }

  private rawEmit(event: TerminalEvent): void {
    this.onEvent(event)
  }
}
