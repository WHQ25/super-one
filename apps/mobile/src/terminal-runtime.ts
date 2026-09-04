import type { RelayClient, TerminalPaint } from '@superone/relay-client'
import { TerminalAssembler } from '@superone/relay-client'
import { randomId } from './ids'

export class TerminalRuntime {
  readonly assembler = new TerminalAssembler()
  terminalId = ''
  writable = false
  status = 'running'
  title = 'Terminal'
  private recoveryTarget: { projectPath: string; sessionId?: string } | null = null

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (paints: TerminalPaint[]) => void,
  ) {}

  ingest(raw: unknown): void {
    const paints = this.assembler.apply(raw)
    for (const p of paints) {
      if (p.kind === 'replace') {
        this.terminalId = p.snapshot.terminalId
        this.writable = p.snapshot.writableByMe
        this.status = p.snapshot.status
        this.title = p.snapshot.title || this.title
      } else if (p.kind === 'meta') {
        if (typeof p.writableByMe === 'boolean') this.writable = p.writableByMe
      } else if (p.kind === 'result' && p.ok && p.terminalId) {
        this.terminalId = p.terminalId
      } else if (p.kind === 'exited') {
        this.status = 'exited'
        this.writable = false
      }
    }
    if (paints.length) this.onPaint(paints)
  }

  create(projectPath: string, sessionId?: string): void {
    this.recoveryTarget = { projectPath, ...(sessionId ? { sessionId } : {}) }
    this.client.send({
      type: 'terminal_create',
      requestId: randomId(),
      projectPath,
      ...(sessionId ? { sessionId } : {}),
    })
  }

  /** Restore the terminal subscription after transport/session recovery. */
  recover(): void {
    if (this.status === 'exited') return
    if (this.terminalId) {
      this.subscribe()
      return
    }
    if (this.recoveryTarget) this.create(this.recoveryTarget.projectPath, this.recoveryTarget.sessionId)
  }

  input(data: string): void {
    if (!this.terminalId || !this.writable || this.status !== 'running' || !data) return
    this.client.send({ type: 'terminal_input', terminalId: this.terminalId, data })
  }

  resize(cols: number, rows: number): void {
    if (!this.terminalId || !this.writable || this.status !== 'running') return
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return
    if (cols < 2 || cols > 1_000 || rows < 1 || rows > 500) return
    this.client.send({ type: 'terminal_resize', terminalId: this.terminalId, cols, rows })
  }

  handleViewMessage(raw: unknown): void {
    let value = raw
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { return }
    }
    if (!value || typeof value !== 'object') return
    const message = value as { type?: string; data?: unknown; cols?: unknown; rows?: unknown }
    if (message.type === 'terminalInput' && typeof message.data === 'string') {
      this.input(message.data)
      return
    }
    if (message.type === 'terminalResize') {
      if (typeof message.cols === 'number' && typeof message.rows === 'number') {
        this.resize(message.cols, message.rows)
      }
      return
    }
    if (message.type === 'terminalReady' && this.terminalId) {
      this.subscribe()
    }
  }

  claim(): void {
    if (!this.terminalId) return
    this.client.send({ type: 'terminal_claim', requestId: randomId(), terminalId: this.terminalId })
  }

  private subscribe(): void {
    this.client.send({ type: 'terminal_subscribe', requestId: randomId(), terminalId: this.terminalId })
  }
}
