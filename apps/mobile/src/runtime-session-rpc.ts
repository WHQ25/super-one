import type { RelayClient } from '@superone/relay-client'
import type { SessionRef } from '@superone/shared/environment/refs'

export type MobileRpcClient = {
  rpc(...args: Parameters<RelayClient['rpc']>): Promise<unknown>
  controlledRpc(...args: Parameters<RelayClient['controlledRpc']>): Promise<unknown>
  resolveProject: RelayClient['resolveProject']
  environmentId: RelayClient['environmentId']
}

/** Capture the execution host before a request can await or the visible session can change. */
export function runtimeSessionRef(client: Pick<RelayClient, 'environmentId'>, sessionId: string, sourceEnvironmentId: string | null): SessionRef {
  const environmentId = sourceEnvironmentId ?? client.environmentId
  if (!environmentId || !sessionId) throw new Error('No authenticated session')
  return { environmentId, sessionId }
}

export function readRuntimeSession<T>(client: RelayClient, session: SessionRef, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  return client.rpc<T>(method, { ...payload, sessionId: session.sessionId }, { environmentId: session.environmentId })
}
