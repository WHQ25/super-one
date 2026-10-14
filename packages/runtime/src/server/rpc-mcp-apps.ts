/**
 * `mcpApps.*`: what a remote desktop's MCP App host asks of the node that owns
 * the session — the saved attachment and its HTML, host state writes, and
 * provider operations (tools, resources, calls, sign-in) on the session's live
 * MCP connection. Writes and provider control present the session lease.
 */
import { OPERATION_SCOPES } from '@superone/shared/environment'
import { McpAppsError, type McpAppAttachmentUpdate, type McpAppOrigin, type McpAppsBinding, type McpAppsProvider } from '@superone/shared/mcp-apps'
import type { McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import type { McpAppsCancelRpcRequest, McpAppsProviderRpcRequest } from '@superone/shared/environment/mcp-apps-rpc'
import type { McpAppsResolveAttachmentRequest, McpAppsResolvedAttachment, McpAppsStateRpcRequest } from '@superone/shared/environment/mcp-apps-state-rpc'
import { dispatchMcpAppsProviderRequest } from '../mcp-apps/provider-rpc'
import { requireScopes, type RpcHandlerTable } from './rpc-helpers'
import type { RpcContext as HostRpcContext, RpcResult } from './rpc-context'

/**
 * A host's MCP Apps, by session. Each call throws {@link McpAppsError} for an
 * attachment or binding that is not this host's session's (a binding names
 * its node the way the host does: the node id, or `local` on a desktop).
 */
export interface McpAppsPort {
  resolveMcpAppAttachment(sessionId: string, appInstanceId: string): McpAppsResolvedAttachment
  loadMcpAppResource(sessionId: string, appInstanceId: string): McpAppResourceSnapshot
  /** Persist a host state write; a resource update must carry its HTML. */
  updateMcpApp(sessionId: string, appInstanceId: string, update: McpAppAttachmentUpdate): void
  getMcpAppsProvider(binding: McpAppsBinding, origin: McpAppOrigin): Promise<McpAppsProvider>
}

type RpcContext = HostRpcContext & Required<Pick<HostRpcContext, 'mcpApps'>>

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

function failed(error: unknown): RpcResult {
  return { result: { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'denied', message: error instanceof Error ? error.message : String(error) } } }
}

function assertControl(ctx: RpcContext, sessionId: string, control: { leaseId?: string; generation?: string }): void {
  ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId }, leaseId: control.leaseId ?? '', generation: control.generation ?? '', holderClientId: ctx.client.clientSessionId })
}

function read(method: 'mcpApps.resource' | 'mcpApps.resolveAttachment') {
  return (payload: unknown, ctx: RpcContext): RpcResult => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
    if (denied) return denied
    const input = payload as McpAppsResolveAttachmentRequest
    if (typeof input?.sessionId !== 'string' || !input.sessionId || typeof input.appInstanceId !== 'string' || !input.appInstanceId) return { error: { code: 'invalid_argument', message: 'MCP App attachment identity required' } }
    try {
      return { result: { ok: true, value: method === 'mcpApps.resource' ? ctx.mcpApps.loadMcpAppResource(input.sessionId, input.appInstanceId) : ctx.mcpApps.resolveMcpAppAttachment(input.sessionId, input.appInstanceId) } }
    } catch (error) {
      return failed(error)
    }
  }
}

export const MCP_APPS_HANDLERS: RpcHandlerTable<RpcContext> = {
  'mcpApps.resolveAttachment': read('mcpApps.resolveAttachment'),
  'mcpApps.resource': read('mcpApps.resource'),
  'mcpApps.cancel': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const { invocationId } = payload as McpAppsCancelRpcRequest
    if (typeof invocationId !== 'string' || !invocationId) return { error: { code: 'invalid_argument', message: 'MCP App invocation id required' } }
    invocation(ctx.client.clientSessionId, invocationId).abort()
    return { result: null }
  },
  'mcpApps.state': (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const input = payload as McpAppsStateRpcRequest & { leaseId?: string; generation?: string }
    if (!input?.sessionId || !input.appInstanceId || !input.update) return { error: { code: 'invalid_argument', message: 'MCP App state identity required' } }
    try {
      assertControl(ctx, input.sessionId, input)
      ctx.mcpApps.updateMcpApp(input.sessionId, input.appInstanceId, input.update)
      return { result: { ok: true, value: null } }
    } catch (error) {
      return failed(error)
    }
  },
  'mcpApps.provider': async (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
    if (denied) return denied
    const input = payload as McpAppsProviderRpcRequest & { leaseId?: string; generation?: string; invocationId?: string }
    if (!input?.binding?.session || !input.binding.node || !input.origin?.providerSessionId) return { error: { code: 'invalid_argument', message: 'MCP Apps binding required' } }
    const clientSessionId = ctx.client.clientSessionId
    const controller = typeof input.invocationId === 'string' && input.invocationId ? invocation(clientSessionId, input.invocationId) : undefined
    try {
      const control = () => assertControl(ctx, input.binding.session, input)
      control()
      const provider = await ctx.mcpApps.getMcpAppsProvider(input.binding, input.origin)
      return { result: await dispatchMcpAppsProviderRequest(input, provider, controller?.signal, control) }
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
  },
}
