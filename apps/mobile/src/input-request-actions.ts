import type { RelayClient } from '@superone/relay-client'
import type { PermissionRequest, RemoteCommand } from '@superone/shared/agent-types'
import { isInputRequest } from '@superone/shared/input-request-presentation'
import { inputRequestMessageText } from '@superone/shared/input-request'
import type { SchemaFormValue } from '@superone/shared/schema-form'
import type { ChatRuntime } from './runtime'

/** Capture the session before any host round-trip; a later navigation never redirects it. */
export function inputRequestActions(options: {
  client: RelayClient; runtime: ChatRuntime; request: PermissionRequest
  sendOptions?: Parameters<ChatRuntime['send']>[1]
}) {
  const { client, runtime, request } = options
  const owner = { projectPath: runtime.projectPath, sessionId: runtime.sessionId }
  const live = () => {
    if (runtime.projectPath !== owner.projectPath || runtime.sessionId !== owner.sessionId
      || !runtime.session.pendingPermissions.some(item => item.requestId === request.requestId)) throw new Error('This input request is no longer active.')
  }
  const answer = async (values?: Record<string, SchemaFormValue>) => {
    live()
    const response = await client.request({ type: 'respond_permission', requestId: request.requestId,
      ...owner, decision: values !== undefined,
      ...(values !== undefined ? { formAnswers: values } : {}),
    } as RemoteCommand) as { handled?: boolean; error?: string } | null
    if (response?.error || response?.handled !== true) throw new Error(response?.error ?? 'Could not submit. Please try again.')
  }
  return {
    cancel: () => answer(),
    submit: async (values: Record<string, SchemaFormValue>) => {
      live()
      if (!isInputRequest(request) || !request.schemaForm) throw new Error('This input request is no longer active.')
      if (request.inputRequest.output === 'caller') return answer(values)
      // Ordinary send owns optimistic failure, its same-id retry and the captured form values.
      runtime.send(inputRequestMessageText(request.inputRequest, request.schemaForm, values), {
        ...options.sendOptions, inputRequest: { requestId: request.requestId, values },
      })
    },
  }
}
