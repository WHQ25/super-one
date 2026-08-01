import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import type { IPty } from 'node-pty'
import type { TerminalReadResult } from '@superone/shared/environment'
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

  constructor(private readonly db: NodeDatabase) {}

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
    }
    proc.onData(onChunk)
    proc.onExit(({ exitCode }) => {
      info.exitedAt = Date.now()
      info.exitCode = exitCode
      info.updatedAt = info.exitedAt
      live.proc = null
      this.db
        .prepare(
          `UPDATE terminals SET updated_at = ?, exited_at = ?, exit_code = ? WHERE terminal_id = ?`,
        )
        .run(info.updatedAt, info.exitedAt, exitCode, terminalId)
    })

    return { ...info }
  }

  get(terminalId: string): NodeTerminalInfo | null {
    const live = this.byId.get(terminalId)
    return live ? { ...live.info } : null
  }

  attach(terminalId: string): { snapshot: string; sequence: string } {
    const live = this.byId.get(terminalId)
    if (!live) throw Object.assign(new Error('terminal not found'), { code: 'not_found' })
    return {
      snapshot: live.info.snapshot,
      sequence: String(live.info.sequence),
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
