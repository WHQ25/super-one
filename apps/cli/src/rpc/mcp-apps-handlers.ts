import { hasAllScopes, OPERATION_SCOPES } from '@superone/shared/environment'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsProviderRpcRequest } from '@superone/shared/environment/mcp-apps-rpc'
import type { McpAppsResolveAttachmentRequest, McpAppsStateRpcRequest } from '@superone/shared/environment/mcp-apps-state-rpc'
import type { RpcContext, RpcResult } from './handlers'

export async function dispatchMcpAppsRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  if (method !== 'mcpApps.provider' && method !== 'mcpApps.state' && method !== 'mcpApps.resolveAttachment') return null
  if (method === 'mcpApps.resolveAttachment') {
    if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.readSession)) return { error: { code: 'forbidden', message: 'session:read required' } }
    const input = payload as McpAppsResolveAttachmentRequest
    if (typeof input?.sessionId !== 'string' || !input.sessionId || typeof input.appInstanceId !== 'string' || !input.appInstanceId) return { error: { code: 'invalid_argument', message: 'MCP App attachment identity required' } }
    try {
      return { result: { ok: true, value: ctx.sessions.resolveMcpAppAttachment(input.sessionId, input.appInstanceId) } }
    } catch (error) {
      return { result: { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'denied', message: error instanceof Error ? error.message : String(error) } } }
    }
  }
  if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.operateSession)) return { error: { code: 'forbidden', message: 'session:operate required' } }
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
  const input = payload as McpAppsProviderRpcRequest & { leaseId?: string; generation?: string }
  if (!input?.binding?.session || !input.origin?.providerSessionId || input.binding.node !== ctx.identity.environmentId) return { error: { code: 'invalid_argument', message: 'MCP Apps binding required' } }
  try {
    ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId: input.binding.session }, leaseId: input.leaseId ?? '', generation: input.generation ?? '', holderClientId: ctx.client.clientSessionId })
    const provider = await ctx.sessions.getMcpAppsProvider(input.binding, input.origin)
    return { result: await dispatchMcpAppsProviderRequest(input, provider) }
  } catch (error) {
    if (error instanceof McpAppsError) return { result: { ok: false, error: error.toJSON() } }
    return { error: { code: 'failed_precondition', message: error instanceof Error ? error.message : String(error) } }
  }
}
