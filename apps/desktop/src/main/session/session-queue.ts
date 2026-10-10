import type { ClaudeSteerPriority } from '@superone/shared/agent-types'
import type { BackendCommand } from './types'

const operations = new Map<string, Promise<unknown>>()

/** Keep enqueue, dequeue and steer ordered across every frontend of a session. */
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
  priority: ClaudeSteerPriority,
): Extract<BackendCommand, { kind: 'claude.steer_queued' | 'acp.steer_queued' | 'codex.steer_queued' | 'dsh.steer_queued' }> | null {
  if (harnessId === 'claude') return { kind: 'claude.steer_queued', clientMessageId, priority }
  if (harnessId === 'acp') return { kind: 'acp.steer_queued', clientMessageId, priority }
  // Codex's queue cannot steer at the next boundary without interrupting.
  if (harnessId === 'codex' && priority !== 'next') return { kind: 'codex.steer_queued', clientMessageId }
  if (harnessId === 'dsh') return { kind: 'dsh.steer_queued', clientMessageId }
  return null
}
