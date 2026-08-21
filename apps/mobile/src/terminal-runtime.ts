import type { RelayClient, TerminalPaint } from '@superone/relay-client'
import { TerminalAssembler } from '@superone/relay-client'
import { randomId } from './ids'

export class TerminalRuntime {
  readonly assembler = new TerminalAssembler()
  terminalId = ''
  writable = false
  status = 'running'
  title = 'Terminal'

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
    this.client.send({
      type: 'terminal_create',
      requestId: randomId(),
      projectPath,
      ...(sessionId ? { sessionId } : {}),
    })
  }

  input(data: string): void {
    if (!this.terminalId) return
    this.client.send({ type: 'terminal_input', terminalId: this.terminalId, data })
  }

  claim(): void {
    if (!this.terminalId) return
    this.client.send({ type: 'terminal_claim', requestId: randomId(), terminalId: this.terminalId })
  }
}
