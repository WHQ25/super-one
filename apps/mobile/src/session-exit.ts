import type { RelayClient } from '@superone/relay-client'

type SessionRuntime = { sessionId: string; epoch: number; dispose(): void }
type RuntimeRef = { current: SessionRuntime | null }

/** Clear the runtime even if transport send fails, so reconnect cannot reopen it. */
export function leaveMobileSession(client: Pick<RelayClient, 'send'> | null, runtimeRef: RuntimeRef): void {
  const runtime = runtimeRef.current
  runtimeRef.current = null
  try {
    if (runtime?.sessionId) client?.send({ type: 'leave_session', sessionId: runtime.sessionId })
  } finally {
    runtime?.dispose()
  }
}

export function sessionRemovalStatus(events: unknown[], runtime: SessionRuntime | null, epoch: number): string | null {
  if (!runtime || runtime.epoch !== epoch) return null
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const frame = event as { type?: unknown; sessionId?: unknown }
    if (frame.sessionId !== runtime.sessionId) continue
    if (frame.type === 'session_kicked') return 'Desktop disconnected this session'
    if (frame.type === 'session_closed') return 'This session was closed'
  }
  return null
}
