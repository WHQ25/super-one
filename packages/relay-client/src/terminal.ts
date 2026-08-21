import type { TerminalEvent, TerminalSnapshot } from '@superone/shared/agent-types'

export type TerminalPaint =
  | { kind: 'replace'; ansi: string; snapshot: TerminalSnapshot }
  | { kind: 'append'; data: string }
  | { kind: 'meta'; snapshot?: Partial<TerminalSnapshot>; writableByMe?: boolean; ownerDeviceId?: string | null }
  | { kind: 'exited'; exitCode: number | null; signal: number | null }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'result'; requestId: string; ok: boolean; terminalId?: string; message?: string }

type ChunkAcc = {
  total: number
  parts: Map<number, string>
  snapshot?: TerminalSnapshot
}

/** Reassemble snapshot chunks and strip seq/ack. Terminal never ACKs. */
export class TerminalAssembler {
  private readonly chunks = new Map<string, ChunkAcc>()
  snapshot: TerminalSnapshot | null = null

  reset(): void {
    this.chunks.clear()
    this.snapshot = null
  }

  apply(raw: unknown): TerminalPaint[] {
    if (!raw || typeof raw !== 'object') return []
    const ev = raw as Partial<TerminalEvent> & { type?: string }
    switch (ev.type) {
      case 'terminal_snapshot': {
        const snap = (ev as { snapshot: TerminalSnapshot }).snapshot
        const ansi = (ev as { ansi?: string }).ansi ?? ''
        this.snapshot = snap
        return [{ kind: 'replace', ansi, snapshot: snap }]
      }
      case 'terminal_snapshot_chunk': {
        const chunk = ev as {
          snapshotId: string
          index: number
          total: number
          ansi: string
          snapshot?: TerminalSnapshot
        }
        const acc: ChunkAcc = this.chunks.get(chunk.snapshotId) ?? { total: chunk.total, parts: new Map() }
        acc.parts.set(chunk.index, chunk.ansi ?? '')
        if (chunk.snapshot) acc.snapshot = chunk.snapshot
        this.chunks.set(chunk.snapshotId, acc)
        if (acc.parts.size < acc.total) return []
        this.chunks.delete(chunk.snapshotId)
        const snap = acc.snapshot
        if (!snap) return []
        let ansi = ''
        for (let i = 0; i < acc.total; i++) ansi += acc.parts.get(i) ?? ''
        this.snapshot = snap
        return [{ kind: 'replace', ansi, snapshot: snap }]
      }
      case 'terminal_output': {
        const data = (ev as { data?: string }).data ?? ''
        return data ? [{ kind: 'append', data }] : []
      }
      case 'terminal_owner_changed': {
        const owner = ev as { ownerDeviceId: string | null; writableByMe: boolean }
        if (this.snapshot) {
          this.snapshot = {
            ...this.snapshot,
            ownerDeviceId: owner.ownerDeviceId,
            writableByMe: owner.writableByMe,
          }
        }
        return [{ kind: 'meta', writableByMe: owner.writableByMe, ownerDeviceId: owner.ownerDeviceId }]
      }
      case 'terminal_exited': {
        const e = ev as { exitCode: number | null; signal: number | null }
        return [{ kind: 'exited', exitCode: e.exitCode, signal: e.signal }]
      }
      case 'terminal_error': {
        const e = ev as { code: string; message: string }
        return [{ kind: 'error', code: e.code, message: e.message }]
      }
      case 'terminal_command_result': {
        const e = ev as { requestId: string; ok: boolean; terminalId?: string; message?: string }
        return [{ kind: 'result', requestId: e.requestId, ok: e.ok, terminalId: e.terminalId, message: e.message }]
      }
      default:
        return []
    }
  }
}
