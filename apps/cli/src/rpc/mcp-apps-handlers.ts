import { hasAllScopes, OPERATION_SCOPES } from '@superone/shared/environment'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsCancelRpcRequest, McpAppsProviderRpcRequest } from '@superone/shared/environment/mcp-apps-rpc'
import type { McpAppsResolveAttachmentRequest, McpAppsStateRpcRequest } from '@superone/shared/environment/mcp-apps-state-rpc'
import type { RpcContext, RpcResult } from './handlers'

/**
 * In-flight `mcpApps.provider` requests per client, by the client's invocation id, so the
 * client that started one can abort it when its View goes away. A cancel may arrive first.
 */
const invocations = new Map<string, Map<string, AbortController>>()

function invocation(clientSessionId: string, invocationId: string): AbortController {
  let client = invocations.get(clientSessionId)
  if (!client) invocations.set(clientSessionId, client = new Map())
  let controller = client.get(invocationId)
  if (!controller) client.set(invocationId, controller = new AbortController())
  return controller
}

/** A gone client can no longer receive its results; its pending forms must not linger. */
export function cancelMcpAppsInvocationsForClient(clientSessionId: string): void {
  for (const controller of invocations.get(clientSessionId)?.values() ?? []) controller.abort()
  invocations.delete(clientSessionId)
}

export const MCP_APPS_RPC_METHODS: ReadonlySet<string> = new Set(['mcpApps.provider', 'mcpApps.cancel', 'mcpApps.state', 'mcpApps.resolveAttachment', 'mcpApps.resource'])

export async function dispatchMcpAppsRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  if (!MCP_APPS_RPC_METHODS.has(method)) return null
  if (method === 'mcpApps.resolveAttachment' || method === 'mcpApps.resource') {
    if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.readSession)) return { error: { code: 'forbidden', message: 'session:read required' } }
    const input = payload as McpAppsResolveAttachmentRequest
    if (typeof input?.sessionId !== 'string' || !input.sessionId || typeof input.appInstanceId !== 'string' || !input.appInstanceId) return { error: { code: 'invalid_argument', message: 'MCP App attachment identity required' } }
    try {
      return { result: { ok: true, value: method === 'mcpApps.resource' ? ctx.sessions.loadMcpAppResource(input.sessionId, input.appInstanceId) : ctx.sessions.resolveMcpAppAttachment(input.sessionId, input.appInstanceId) } }
    } catch (error) {
      return { result: { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'denied', message: error instanceof Error ? error.message : String(error) } } }
    }
  }
  if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.operateSession)) return { error: { code: 'forbidden', message: 'session:operate required' } }
  if (method === 'mcpApps.cancel') {
    const { invocationId } = payload as McpAppsCancelRpcRequest
    if (typeof invocationId !== 'string' || !invocationId) return { error: { code: 'invalid_argument', message: 'MCP App invocation id required' } }
    invocation(ctx.client.clientSessionId, invocationId).abort()
    return { result: null }
  }
  const control = payload as { leaseId?: string; generation?: string }
  if (method === 'mcpApps.state') {
    const input = payload as McpAppsStateRpcRequest
    if (!input?.sessionId || !input.appInstanceId || !input.update) return { error: { code: 'invalid_argument', message: 'MCP App state identity required' } }
    try {
      ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId: input.sessionId }, leaseId: control.leaseId ?? '', generation: control.generation ?? '', holderClientId: ctx.client.clientSessionId })
      ctx.sessions.updateMcpApp(input.sessionId, input.appInstanceId, input.update)
      return { result: { ok: true, value: null } }
    } catch (error) {
      return { result: { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'denied', message: error instanceof Error ? error.message : String(error) } } }
    }
  }
  const input = payload as McpAppsProviderRpcRequest & { leaseId?: string; generation?: string; invocationId?: string }
  if (!input?.binding?.session || !input.origin?.providerSessionId || input.binding.node !== ctx.identity.environmentId) return { error: { code: 'invalid_argument', message: 'MCP Apps binding required' } }
  const clientSessionId = ctx.client.clientSessionId
  const controller = typeof input.invocationId === 'string' && input.invocationId ? invocation(clientSessionId, input.invocationId) : undefined
  try {
    ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId: input.binding.session }, leaseId: input.leaseId ?? '', generation: input.generation ?? '', holderClientId: clientSessionId })
    const provider = await ctx.sessions.getMcpAppsProvider(input.binding, input.origin)
    return { result: await dispatchMcpAppsProviderRequest(input, provider, controller?.signal) }
  } catch (error) {
    if (error instanceof McpAppsError) return { result: { ok: false, error: error.toJSON() } }
    return { error: { code: 'failed_precondition', message: error instanceof Error ? error.message : String(error) } }
  } finally {
    if (controller) {
      const client = invocations.get(clientSessionId)
      if (client?.get(input.invocationId!) === controller) client.delete(input.invocationId!)
      if (client && !client.size) invocations.delete(clientSessionId)
    }
  }
}
