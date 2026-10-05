import type { RelayClient } from '@superone/relay-client'
import type { OpenWidgetInputRequestResult } from '@superone/shared/agent-types'
import type { InputRequestSpec } from '@superone/shared/input-request'
import { randomId } from './ids'

/** The native shell supplies the current transcript owner; widgets cannot supply a session. */
export async function openWidgetInputRequest(client: RelayClient, owner: { projectPath: string; sessionId: string }, messageId: string, spec: InputRequestSpec) {
  const result = await client.request({ type: 'open_widget_input_request', requestId: randomId(), ...owner, messageId, spec }) as OpenWidgetInputRequestResult
  if (!result.ok) throw new Error(result.error.message)
}
