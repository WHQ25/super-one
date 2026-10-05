import { admitInputRequestSpec, composerRequestResultValue, inputRequestMeta } from '@superone/shared/input-request'
import { openInputRequest } from '../session/input-requests'
import { denyMainThreadOnlyIfSubagent } from './main-thread-session-guard'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

/** `composer_request`: a form in the calling session's composer, answered by the user. */
export async function composerRequestHandler(args: Record<string, unknown>, deps: BuiltInSuperoneToolDeps) {
  const denied = await denyMainThreadOnlyIfSubagent(deps.sessionId, 'composer_request')
  if (denied) return toolResult(`[Error] ${denied}`, true)
  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.emitHostEvent) return toolResult('[Error] This session cannot show a form. Ask the user in chat instead.', true)
  const admitted = admitInputRequestSpec(args, { userResources: true })
  if (!admitted.ok) return toolResult(`[Error] ${admitted.error}. Fix the form and call composer_request again.`, true)
  const { outcome } = openInputRequest(
    { id: deps.sessionId, emitHostEvent: (event) => session.emitHostEvent!(event) },
    {
      meta: inputRequestMeta(admitted.spec, { kind: 'agent' }, 'caller'),
      form: admitted.form,
      ...(deps.signal ? { signal: deps.signal } : {}),
    },
  )
  return toolResult(composerRequestResultValue(await outcome))
}
