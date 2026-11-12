import { isAcpProtocolHarness } from '@superone/shared/acp-brand'
import type { BackendCommand } from './types'

const operations = new Map<string, Promise<unknown>>()

export function enqueueSessionQueueOp<T>(sessionId: string, op: () => Promise<T>): Promise<T> {
  const previous = operations.get(sessionId) ?? Promise.resolve()
  const next = previous.then(op, op)
  operations.set(sessionId, next)
  const cleanup = () => { if (operations.get(sessionId) === next) operations.delete(sessionId) }
  void next.then(cleanup, cleanup)
  return next
}

export function queuedSteerCommand(
  harnessId: string,
  clientMessageId: string,
): Extract<BackendCommand, { kind: 'claude.steer_queued' | 'acp.steer_queued' | 'codex.steer_queued' | 'dsh.steer_queued' | 'opencode.steer_queued' }> | null {
  if (harnessId === 'claude') return { kind: 'claude.steer_queued', clientMessageId }
  if (isAcpProtocolHarness(harnessId)) return { kind: 'acp.steer_queued', clientMessageId }
  if (harnessId === 'codex') return { kind: 'codex.steer_queued', clientMessageId }
  if (harnessId === 'opencode') return { kind: 'opencode.steer_queued', clientMessageId }
  if (harnessId === 'dsh') return { kind: 'dsh.steer_queued', clientMessageId }
  return null
}
