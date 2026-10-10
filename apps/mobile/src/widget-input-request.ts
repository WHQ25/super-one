import type { RelayClient } from '@superone/relay-client'
import type { OpenWidgetInputRequestResult } from '@superone/shared/agent-types'
import type { InputRequestSpec } from '@superone/shared/input-request'
import { runtimeSessionRef } from './runtime-session-rpc'

/** The native shell supplies the current transcript owner; widgets cannot supply a session. */
export async function openWidgetInputRequest(client: RelayClient, owner: { projectPath: string; sessionId: string; environmentId?: string | null }, messageId: string, spec: InputRequestSpec) {
  const result = await client.controlledRpc(runtimeSessionRef(client, owner.sessionId, owner.environmentId ?? null), 'composer.openInputRequest', { messageId, spec }) as OpenWidgetInputRequestResult
  if (!result.ok) throw new Error(result.error.message)
}
