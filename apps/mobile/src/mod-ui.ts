import type { MobileRpcClient } from './runtime-session-rpc'
import { MOD_UI_MUTATING_OPS, type ModUiOp, type ModUiRequest } from '@superone/shared/mod-ui'
import { runtimeSessionRef } from './runtime-session-rpc'
import { projectRpc } from './project-rpc'

/** The CLI answers a mod op within 15 s; the relay waits a little longer. */
const MOD_UI_TIMEOUT_MS = 20_000

export interface ModUiPayload {
  op: ModUiOp
  request: ModUiRequest
}

export function parseModUiPayload(payload: unknown): ModUiPayload {
  const p = payload as Record<string, unknown> | undefined
  if (!p || typeof p.op !== 'string' || !p.request || typeof p.request !== 'object') throw new Error('invalid modUi payload')
  return { op: p.op as ModUiOp, request: p.request as ModUiRequest }
}

/**
 * Carries one mod op from the chat document to the desktop, which stamps this
 * phone's surface and client id. Rejects with the desktop's refusal so the
 * document's client can tell "no mods here" (`mod-ui-unavailable`) apart.
 */
export async function invokeModUi(
  client: Pick<MobileRpcClient, 'rpc' | 'controlledRpc' | 'resolveProject' | 'environmentId'>,
  session: { projectPath: string; sessionId: string; environmentId?: string | null },
  { op, request }: ModUiPayload,
): Promise<unknown> {
  const payload = { op, request }
  return MOD_UI_MUTATING_OPS.has(op)
    ? client.controlledRpc(runtimeSessionRef(client, session.sessionId, session.environmentId ?? null), 'session.modUi', payload, { timeoutMs: MOD_UI_TIMEOUT_MS })
    : projectRpc(client, session.projectPath, 'session.modUi', { ...payload, sessionId: session.sessionId }, { timeoutMs: MOD_UI_TIMEOUT_MS })
}
