import { createRequire } from 'node:module'
import type { Terminal as XTermHeadless } from '@xterm/headless'
import type { SerializeAddon as SerializeAddonInstance } from '@xterm/addon-serialize'
import { basename } from 'node:path'
import type {
  TerminalAgentControl,
  TerminalEvent,
  TerminalListItem,
  TerminalSnapshot,
  TerminalStatus,
} from '@superone/shared/agent-types'
import { defaultShell, type PtyLike, type PtySpawner } from './pty'
import { TerminalOwnership } from './terminal-ownership'
import { TerminalControl, type TerminalControlOptions } from './terminal-control'

const nodeRequire = createRequire(import.meta.url)
const { Terminal } = nodeRequire('@xterm/headless') as typeof import('@xterm/headless')
const { SerializeAddon } = nodeRequire('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

export interface TerminalSessionOptions {
  terminalId: string
  cwd: string
  projectPath?: string
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
  /** Tab opened by an agent tool rather than the user. */
  openedByAgent?: boolean
  control?: TerminalControlOptions
}

const DEFAULT_COALESCE_MS = 24
const DEFAULT_SNAPSHOT_SOFT_LIMIT = 256 * 1024
/** Lines kept above the viewport — what `terminal_snapshot scrollback` can reach. */
const SCROLLBACK_LINES = 5_000

export interface TerminalScreenCursor {
  row: number
  col: number
}

/** Login shells report as `-zsh`; `pty.process` may give a path or a bare name. */
function processBaseName(name: string): string {
  return basename(name).replace(/^-/, '')
}

export class TerminalSession {
  readonly terminalId: string
  readonly cwd: string
  readonly projectPath: string
  readonly ownership: TerminalOwnership
  readonly control: TerminalControl
  readonly openedByAgent: boolean
  title: string
  lastAnsi = ''
  /** Last PTY output for idle detection; 0 until the process has printed anything. */
  lastOutputAt = 0

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
  private titleDisposable: { dispose(): void } | null = null
  private readonly shellName: string

  constructor(opts: TerminalSessionOptions) {
    this.terminalId = opts.terminalId
    this.cwd = opts.cwd
    this.projectPath = opts.projectPath ?? opts.cwd
    this.title = opts.title
    this.ownership = opts.ownership
    this.onEvent = opts.onEvent
    this.coalesceMs = opts.coalesceMs ?? DEFAULT_COALESCE_MS
    this.snapshotSoftLimit = opts.snapshotSoftLimit ?? DEFAULT_SNAPSHOT_SOFT_LIMIT
    this._cols = opts.cols
    this._rows = opts.rows
    this.openedByAgent = opts.openedByAgent === true
    this.shellName = processBaseName(opts.shell || defaultShell())

    this.term = new Terminal({ cols: opts.cols, rows: opts.rows, allowProposedApi: true, scrollback: SCROLLBACK_LINES })
    this.serializer = new SerializeAddon()
    this.term.loadAddon(this.serializer as unknown as Parameters<XTermHeadless['loadAddon']>[0])
    this.titleDisposable = this.term.onTitleChange((title) => this.applyTitle(title))

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
    this.control = new TerminalControl(
      {
        terminalId: this.terminalId,
        isAtShell: () => this.isAtShell(),
        lastOutputAt: () => this.lastOutputAt,
        emit: (event) => this.emit(event),
      },
      opts.control,
    )
  }

  get status(): TerminalStatus {
    return this._status
  }

  get cols(): number {
    return this._cols
  }

  get rows(): number {
    return this._rows
  }

  listItem(): TerminalListItem {
    return {
      terminalId: this.terminalId,
      cwd: this.cwd,
      projectPath: this.projectPath,
      title: this.title,
      status: this._status,
      ownerDeviceId: this.ownership.ownerDeviceId,
      agentControl: this.control.current,
      openedByAgent: this.openedByAgent,
    }
  }

  /** Base name of the foreground process — the shell at a prompt, else the running command. */
  foregroundProcess(): string {
    if (this._status !== 'running') return ''
    return processBaseName(this.pty.foregroundProcess())
  }

  isAtShell(): boolean {
    return this.foregroundProcess() === this.shellName
  }

  get agentControl(): TerminalAgentControl | null {
    return this.control.current
  }

  /** True while a full-screen program (vim, htop) owns the terminal. */
  get altScreen(): boolean {
    return this.term.buffer.active.type === 'alternate'
  }

  /** DECCKM — full-screen programs expect `ESC O A` style cursor keys while set. */
  get applicationCursor(): boolean {
    return this.term.modes.applicationCursorKeysMode
  }

  cursor(): TerminalScreenCursor {
    const buffer = this.term.buffer.active
    return { row: buffer.cursorY, col: buffer.cursorX }
  }

  /** The visible rows as plain text, trailing blank lines dropped. */
  async screenLines(): Promise<string[]> {
    await this.settle()
    const buffer = this.term.buffer.active
    return trimTrailingBlankLines(
      Array.from({ length: this._rows }, (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? ''),
    )
  }

  /** The last `tail` lines of scrollback + viewport as plain text. */
  async bufferTail(tail: number): Promise<{ lines: string[]; totalLines: number }> {
    await this.settle()
    const buffer = this.term.buffer.active
    const totalLines = buffer.baseY + this._rows
    const start = Math.max(0, totalLines - tail)
    const lines: string[] = []
    for (let y = start; y < totalLines; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
    return { lines: trimTrailingBlankLines(lines), totalLines }
  }

  /** Input from an agent session: only while it controls the tab's foreground command. */
  agentInput(sessionId: string, data: string): boolean {
    if (!this.control.heldBy(sessionId)) return false
    this.input(data)
    return true
  }

  /** The user reclaims the tab; the agent's next write is rejected. */
  takeOver(): void {
    this.control.release('user_took_over')
  }

  /** Flush pending writes into the headless terminal so reads see the latest bytes. */
  private settle(): Promise<void> {
    return new Promise<void>((resolve) => this.term.write('', resolve))
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
    if (this._status === 'exited') {
      this.disposeTerm()
      return
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this._status = 'exited'
    this.rawEmit({ type: 'terminal_exited', terminalId: this.terminalId, exitCode: null, signal: null })
    this.pty.kill()
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
    this.lastOutputAt = Date.now()
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
    if (this._status === 'exited') return
    this.flushBuffer(false)
    this._status = 'exited'
    this.emit({ type: 'terminal_exited', terminalId: this.terminalId, exitCode, signal })
    this.disposeTerm()
  }

  private applyTitle(title: string): void {
    const next = title.trim()
    if (!next || next === this.title) return
    this.title = next
    this.emit({ type: 'terminal_title_changed', terminalId: this.terminalId, title: next })
  }

  private disposeTerm(): void {
    this.control.dispose()
    try {
      this.titleDisposable?.dispose()
    } catch {
      /* already disposed */
    }
    this.titleDisposable = null
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

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end -= 1
  return lines.slice(0, end)
}
