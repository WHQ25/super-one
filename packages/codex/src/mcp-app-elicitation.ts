import { McpAppsError, type McpAppsProvider } from '@superone/shared/mcp-apps'

export interface CodexMcpAppElicitationRequest {
  id: string | number
  params: Record<string, unknown>
}
export type CodexMcpAppElicitationHandler = (request: CodexMcpAppElicitationRequest, signal: AbortSignal) => Promise<Record<string, unknown>>
interface Invocation { signal: AbortSignal; handle: CodexMcpAppElicitationHandler }
interface InvocationScope { controller: AbortController; invocations: Set<Invocation> }
interface ConnectionCalls {
  lifetime: AbortController
  active: Map<string, InvocationScope>
}
const calls = new WeakMap<object, ConnectionCalls>()

function stateFor(connection: object): ConnectionCalls {
  let state = calls.get(connection)
  if (!state) {
    state = { lifetime: new AbortController(), active: new Map() }
    calls.set(connection, state)
  }
  return state
}

/** Native elicitation is answered by request id; parallel calls share one host scope. */
export function withCodexMcpAppElicitation(provider: McpAppsProvider, connection: object, threadId: string, handle: CodexMcpAppElicitationHandler): McpAppsProvider {
  const state = stateFor(connection)
  const key = JSON.stringify([threadId, provider.binding.server])
  const run = async <T>(signal: AbortSignal | undefined, invoke: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController()
    const scopedSignal = AbortSignal.any([state.lifetime.signal, controller.signal, ...(signal ? [signal] : [])])
    if (scopedSignal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
    let scope = state.active.get(key)
    if (!scope) {
      scope = { controller: new AbortController(), invocations: new Set() }
      state.active.set(key, scope)
    }
    const invocation = { signal: scopedSignal, handle }
    scope.invocations.add(invocation)
    const remove = () => {
      scopedSignal.removeEventListener('abort', remove)
      scope.invocations.delete(invocation)
      if (!scope.invocations.size) {
        scope.controller.abort()
        if (state.active.get(key) === scope) state.active.delete(key)
      }
    }
    scopedSignal.addEventListener('abort', remove, { once: true })
    try {
      return await invoke(scopedSignal)
    } finally {
      remove()
      controller.abort()
    }
  }
  return { ...provider,
    readResource: (request, signal) => run(signal, scoped => provider.readResource(request, scoped)),
    callTool: (request, signal) => run(signal, scoped => provider.callTool(request, scoped)),
  }
}

/** Only standalone elicitation from an active native invocation is intercepted. */
export function dispatchCodexMcpAppElicitation(connection: object, request: CodexMcpAppElicitationRequest, signal?: AbortSignal): Promise<Record<string, unknown>> | undefined {
  const { threadId, serverName, turnId } = request.params
  if (typeof threadId !== 'string' || typeof serverName !== 'string' || turnId != null) return undefined
  const state = calls.get(connection)
  const scope = state?.active.get(JSON.stringify([threadId, serverName]))
  if (!scope || !state) return undefined
  const invocation = [...scope.invocations].find(call => !call.signal.aborted)
  if (!invocation) return undefined
  return invocation.handle(request, AbortSignal.any([state.lifetime.signal, scope.controller.signal, ...(signal ? [signal] : [])]))
}

export function cancelCodexMcpAppInvocations(connection: object): void {
  calls.get(connection)?.lifetime.abort()
  calls.delete(connection)
}
