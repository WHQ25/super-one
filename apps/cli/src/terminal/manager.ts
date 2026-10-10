import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import type { IPty } from 'node-pty'
import type { TerminalReadResult } from '@superone/shared/environment'
import type { TerminalEvent, TerminalListItem, TerminalSnapshot } from '@superone/shared/agent-types'
import type { ControlLeaseService } from '@superone/runtime/lease'
import type { NodeDatabase } from '../db/database'

const nodeRequire = createRequire(import.meta.url)
const { spawn } = nodeRequire('node-pty') as typeof import('node-pty')

export interface NodeTerminalInfo {
  terminalId: string
  cwd: string
  title: string
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
  exitedAt: number | null
  exitCode: number | null
  /** Bounded output snapshot for reconnect. */
  snapshot: string
  sequence: number
}

interface LiveTerminal {
  info: NodeTerminalInfo
  proc: IPty | null
  listeners: Set<(chunk: string, sequence: number) => void>
  chunks: Array<{ data: string; sequence: number; bytes: number }>
  chunkBytes: number
}

const SNAPSHOT_SOFT_LIMIT = 64 * 1024
const OUTPUT_BUFFER_SOFT_LIMIT = 256 * 1024

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSHELL || process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/bash'
}

/**
 * Interactive PTY runtime for the node service. Output is retained in a
 * bounded sequence buffer so remote clients can reconnect and poll deltas.
 */
export class NodeTerminalManager {
  private readonly byId = new Map<string, LiveTerminal>()
  private readonly events = new Set<(event: TerminalEvent) => void>()
  private authority: { environmentId: string; leases: ControlLeaseService } | null = null
  private offLeases: (() => void) | null = null

  constructor(private readonly db: NodeDatabase) {}

  bindLeases(environmentId: string, leases: ControlLeaseService): void {
    this.offLeases?.()
    this.authority = { environmentId, leases }
    this.offLeases = leases.onChange(resource => {
      if (!('terminalId' in resource) || resource.environmentId !== environmentId || !this.byId.has(resource.terminalId)) return
      this.emit({ type: 'terminal_owner_changed', terminalId: resource.terminalId, ownerDeviceId: this.owner(resource.terminalId), writableByMe: false })
    })
  }

  onEvent(listener: (event: TerminalEvent) => void): () => void {
    this.events.add(listener)
    return () => { this.events.delete(listener) }
  }

  eventForClient(event: TerminalEvent, clientSessionId: string): TerminalEvent {
    return event.type === 'terminal_owner_changed' ? { ...event, writableByMe: this.writable(event.terminalId, clientSessionId) } : event
  }

  private lease(terminalId: string) { return this.authority?.leases.get({ environmentId: this.authority.environmentId, terminalId }) ?? null }
  private owner(terminalId: string): string | null {
    const lease = this.lease(terminalId)
    return lease ? (lease.delegate ?? lease.holderClientId).replace(/^phone:/, '') : null
  }
  private writable(terminalId: string, clientSessionId: string): boolean {
    const lease = this.lease(terminalId)
    return !!lease && (lease.delegate ? lease.delegate === clientSessionId : lease.holderClientId === clientSessionId)
  }
  private emit(event: TerminalEvent): void { for (const listener of this.events) listener(event) }

  create(opts: { cwd: string; title?: string; cols?: number; rows?: number; shell?: string }): NodeTerminalInfo {
    if (!existsSync(opts.cwd)) {
      throw Object.assign(new Error(`cwd does not exist: ${opts.cwd}`), { code: 'invalid_argument' })
    }
    const terminalId = crypto.randomUUID()
    const now = Date.now()
    const info: NodeTerminalInfo = {
      terminalId,
      cwd: opts.cwd,
      title: opts.title ?? 'Terminal',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      createdAt: now,
      updatedAt: now,
      exitedAt: null,
      exitCode: null,
      snapshot: '',
      sequence: 0,
    }

    const shell = opts.shell || defaultShell()
    const proc = spawn(shell, [], {
      cwd: opts.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      name: 'xterm-256color',
      cols: info.cols,
      rows: info.rows,
    })

    const live: LiveTerminal = {
      info,
      proc,
      listeners: new Set(),
      chunks: [],
      chunkBytes: 0,
    }
    this.byId.set(terminalId, live)

    this.db
      .prepare(
        `INSERT INTO terminals (terminal_id, cwd, title, cols, rows, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(terminalId, info.cwd, info.title, info.cols, info.rows, now, now)

    const onChunk = (chunk: string) => {
      info.sequence += 1
      info.snapshot = (info.snapshot + chunk).slice(-SNAPSHOT_SOFT_LIMIT)
      info.updatedAt = Date.now()
      const bytes = Buffer.byteLength(chunk)
      live.chunks.push({ data: chunk, sequence: info.sequence, bytes })
      live.chunkBytes += bytes
      while (live.chunkBytes > OUTPUT_BUFFER_SOFT_LIMIT && live.chunks.length > 1) {
        live.chunkBytes -= live.chunks.shift()!.bytes
      }
      for (const listener of live.listeners) listener(chunk, info.sequence)
      this.emit({ type: 'terminal_output', terminalId, data: chunk, fromSeq: info.sequence, toSeq: info.sequence, createdAt: info.updatedAt })
    }
    proc.onData(onChunk)
    proc.onExit(({ exitCode }) => {
      info.exitedAt = Date.now()
      info.exitCode = exitCode
      info.updatedAt = info.exitedAt
      live.proc = null
      // node-pty delivers this asynchronously, so for a terminal we killed it
      // arrives after `kill()` already dropped it from `byId` and recorded the
      // exit. On shutdown that is also after `db.close()` (runtime.stop runs
      // `killAll()` then closes), which would throw on a closed connection.
      // Only a self-exit still owns a row here.
      if (this.byId.get(terminalId) !== live) return
      this.db
        .prepare(
          `UPDATE terminals SET updated_at = ?, exited_at = ?, exit_code = ? WHERE terminal_id = ?`,
        )
        .run(info.updatedAt, info.exitedAt, exitCode, terminalId)
      this.authority?.leases.revoke({ environmentId: this.authority.environmentId, terminalId })
      this.emit({ type: 'terminal_exited', terminalId, exitCode, signal: null })
    })

    this.emit({ type: 'terminal_created', terminalId, item: this.list().find(item => item.terminalId === terminalId)! })
    return { ...info }
  }

  get(terminalId: string): NodeTerminalInfo | null {
    const live = this.byId.get(terminalId)
    return live ? { ...live.info } : null
  }

  list(): TerminalListItem[] {
    return [...this.byId.values()].map(({ info }) => ({
      terminalId: info.terminalId,
      cwd: info.cwd,
      title: info.title,
      status: info.exitedAt === null ? 'running' : 'exited',
      ownerDeviceId: this.owner(info.terminalId),
    }))
  }

  attach(terminalId: string, clientSessionId = ''): { snapshot: string; sequence: string; terminal: TerminalSnapshot } {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    return {
      snapshot: live.info.snapshot,
      sequence: String(live.info.sequence),
      terminal: {
        terminalId, cwd: live.info.cwd, title: live.info.title, cols: live.info.cols, rows: live.info.rows,
        status: live.info.exitedAt === null ? 'running' : 'exited', lastSeq: live.info.sequence,
        ownerDeviceId: this.owner(terminalId), writableByMe: this.writable(terminalId, clientSessionId), subscriberCount: 0,
      },
    }
  }

  readAfter(terminalId: string, afterSequence: string): TerminalReadResult {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    const parsed = Number(afterSequence)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw Object.assign(new Error('afterSequence must be a non-negative integer'), {
        code: 'invalid_argument',
      })
    }

    const oldest = live.chunks[0]?.sequence ?? live.info.sequence + 1
    const reset = parsed < oldest - 1
    const selected = reset ? [] : live.chunks.filter((chunk) => chunk.sequence > parsed)
    return {
      data: selected.map((chunk) => chunk.data).join(''),
      fromSequence: String(selected[0]?.sequence ?? live.info.sequence),
      sequence: String(live.info.sequence),
      reset,
      ...(reset ? { snapshot: live.info.snapshot } : {}),
      status: live.info.exitedAt === null ? 'running' : 'exited',
      exitCode: live.info.exitCode,
    }
  }

  write(terminalId: string, data: string): void {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    if (!live.proc || live.info.exitedAt) {
      throw Object.assign(new Error('terminal has exited'), { code: 'failed_precondition' })
    }
    live.proc.write(data)
    live.info.updatedAt = Date.now()
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw Object.assign(new Error('cols and rows must be positive integers'), {
        code: 'invalid_argument',
      })
    }
    live.info.cols = cols
    live.info.rows = rows
    live.info.updatedAt = Date.now()
    if (live.proc && live.info.exitedAt === null) live.proc.resize(cols, rows)
    this.db
      .prepare(`UPDATE terminals SET cols = ?, rows = ?, updated_at = ? WHERE terminal_id = ?`)
      .run(cols, rows, live.info.updatedAt, terminalId)
  }

  kill(terminalId: string): void {
    const live = this.byId.get(terminalId)
    if (!live) return
    live.proc?.kill()
    live.proc = null
    this.byId.delete(terminalId)
    const now = Date.now()
    this.db
      .prepare(`UPDATE terminals SET updated_at = ?, exited_at = COALESCE(exited_at, ?) WHERE terminal_id = ?`)
      .run(now, now, terminalId)
    this.authority?.leases.revoke({ environmentId: this.authority.environmentId, terminalId })
    this.emit({ type: 'terminal_exited', terminalId, exitCode: live.info.exitCode, signal: null })
  }

  subscribeOutput(terminalId: string, listener: (chunk: string, sequence: number) => void): () => void {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    live.listeners.add(listener)
    return () => live.listeners.delete(listener)
  }

  killAll(): void {
    for (const id of [...this.byId.keys()]) this.kill(id)
  }
}
