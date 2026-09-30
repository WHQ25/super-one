import { hasAllScopes, OPERATION_SCOPES } from '@superone/shared/environment'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsProviderRpcRequest } from '@superone/shared/environment/mcp-apps-rpc'
import type { RpcContext, RpcResult } from './handlers'

export async function dispatchMcpAppsRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  if (method !== 'mcpApps.provider') return null
  if (!hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.operateSession)) return { error: { code: 'forbidden', message: 'session:operate required' } }
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
