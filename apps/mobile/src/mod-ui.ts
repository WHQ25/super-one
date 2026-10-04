import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { MOD_UI_UNAVAILABLE, type ModUiOp, type ModUiRequest } from '@superone/shared/mod-ui'
import { randomId } from './ids'

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
  client: Pick<RelayClient, 'request'>,
  session: { projectPath: string; sessionId: string },
  { op, request }: ModUiPayload,
): Promise<unknown> {
  const reply = await client.request(
    { type: 'mod_ui_request', requestId: randomId(), ...session, op, request } as RemoteCommand,
    MOD_UI_TIMEOUT_MS,
  ) as { response?: unknown; error?: string } | null
  if (reply?.error) throw new Error(reply.error)
  if (!reply) throw new Error(`${MOD_UI_UNAVAILABLE}: no reply`)
  return reply.response
}
