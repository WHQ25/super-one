import type { RelayClient } from '@superone/relay-client'

type SessionRuntime = { sessionId: string; epoch: number; sourceEnvironmentId?: string | null; dispose(): void }
type RuntimeRef = { current: SessionRuntime | null }

/** Clear synchronously so reconnect cannot reopen a session while its stream is retiring. */
export async function leaveMobileSession(client: Pick<RelayClient, 'stopSession'> | null, runtimeRef: RuntimeRef): Promise<void> {
  const runtime = runtimeRef.current
  runtimeRef.current = null
  runtime?.dispose()
  if (runtime?.sessionId) await client?.stopSession()
}

export function sessionRemovalStatus(events: unknown[], runtime: SessionRuntime | null, epoch: number): string | null {
  if (!runtime || runtime.epoch !== epoch) return null
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const frame = event as { type?: unknown; sessionId?: unknown; environmentId?: unknown }
    if (frame.environmentId && frame.environmentId !== runtime.sourceEnvironmentId) continue
    if (frame.sessionId !== runtime.sessionId) continue
    if (frame.type === 'session_kicked') return 'Desktop disconnected this session'
    if (frame.type === 'session_closed') return 'This session was closed'
  }
  return null
}
