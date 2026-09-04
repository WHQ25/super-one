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
  chars: number
  snapshot?: TerminalSnapshot
}

export const MAX_TERMINAL_SNAPSHOT_CHUNKS = 1_024
export const MAX_TERMINAL_SNAPSHOT_SETS = 4
export const MAX_TERMINAL_SNAPSHOT_CHUNK_CHARS = 512 * 1_024
export const MAX_TERMINAL_SNAPSHOT_CHARS = 16 * 1_024 * 1_024

function validChunk(chunk: {
  snapshotId?: unknown
  index?: unknown
  total?: unknown
  ansi?: unknown
  snapshot?: TerminalSnapshot
}): chunk is {
  snapshotId: string
  index: number
  total: number
  ansi: string
  snapshot?: TerminalSnapshot
} {
  return typeof chunk.snapshotId === 'string'
    && chunk.snapshotId.length > 0
    && chunk.snapshotId.length <= 256
    && Number.isSafeInteger(chunk.index)
    && Number.isSafeInteger(chunk.total)
    && (chunk.total as number) > 0
    && (chunk.total as number) <= MAX_TERMINAL_SNAPSHOT_CHUNKS
    && (chunk.index as number) >= 0
    && (chunk.index as number) < (chunk.total as number)
    && typeof chunk.ansi === 'string'
    && chunk.ansi.length <= MAX_TERMINAL_SNAPSHOT_CHUNK_CHARS
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
          snapshotId?: unknown
          index?: unknown
          total?: unknown
          ansi?: unknown
          snapshot?: TerminalSnapshot
        }
        if (!validChunk(chunk)) return []
        let acc = this.chunks.get(chunk.snapshotId)
        if (acc && acc.total !== chunk.total) {
          this.chunks.delete(chunk.snapshotId)
          return []
        }
        if (!acc) {
          if (this.chunks.size >= MAX_TERMINAL_SNAPSHOT_SETS) {
            const oldest = this.chunks.keys().next().value as string | undefined
            if (oldest) this.chunks.delete(oldest)
          }
          acc = { total: chunk.total, parts: new Map(), chars: 0 }
        }
        if (!acc.parts.has(chunk.index)) {
          if (acc.chars + chunk.ansi.length > MAX_TERMINAL_SNAPSHOT_CHARS) {
            this.chunks.delete(chunk.snapshotId)
            return []
          }
          acc.parts.set(chunk.index, chunk.ansi)
          acc.chars += chunk.ansi.length
        }
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
