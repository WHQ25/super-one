import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { McpAppsError, type McpAppViewRequest, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDesktopRequestContext } from '@superone/shared/mcp-apps-desktop'
import { mcpAppResources, type McpAppResourceRegistry } from './protocol'
import { mcpAppSessionKey } from './session-key'
import { scheduleMcpAppResourceGc } from './resource-store'

function failure(error: unknown) {
  return { ok: false as const, error: error instanceof McpAppsError ? error.toJSON() : { code: 'invalid' as const, message: error instanceof Error ? error.message : String(error) } }
}

function assertHost(event: IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) throw new McpAppsError('denied', 'MCP App requests must come through the host renderer')
}

/** The document handle binds all iframe-originated operations to native navigation lifetime. */
export function registerMcpAppDocumentIpc(resources: McpAppResourceRegistry = mcpAppResources): void {
  // Sweep an existing CAS at host startup, even if no View is opened this run.
  scheduleMcpAppResourceGc()
  const pending = new Map<string, { owner: number; documentId: string; controller: AbortController }>()
  const owners = new Set<number>()
  ipcMain.handle(AgentIpcChannels.MCP_APP_REGISTER_DOCUMENT, async (event, projectPath: string, sessionId: string, target: { appInstanceId: string; messageId?: string }) => {
    try {
      assertHost(event)
      const sessionKey = mcpAppSessionKey(projectPath, sessionId)
      const { resolveMcpAppHostAttachment, isMcpAppHostActive, executeMcpAppHostRequest } = await import('./executor')
      const resolved = await resolveMcpAppHostAttachment({ sessionKey, appInstanceId: target.appInstanceId, messageId: target.messageId })
      const active = isMcpAppHostActive(resolved)
      let app = resolved.app
      if (app.resource?.html === undefined) {
        if (!app.resource && !active) return { ok: true, value: { state: 'inactive' } }
        const loaded = await executeMcpAppHostRequest({ sessionKey, appInstanceId: target.appInstanceId, messageId: target.messageId, operation: 'load' }, { kind: 'desktop' })
        if (!loaded.ok) return loaded
        app = { ...app, resource: loaded.value as ToolAppAttachment['resource'] }
      }
      if (event.sender.isDestroyed()) throw new McpAppsError('cancelled', 'MCP App container was closed')
      const registration = resources.register(app, event.sender.id, event.sender.mainFrame.url, sessionKey)
      if (!owners.has(event.sender.id)) {
        owners.add(event.sender.id)
        event.sender.once('destroyed', () => {
          resources.releaseOwner(event.sender.id)
          owners.delete(event.sender.id)
          for (const [key, request] of pending) if (request.owner === event.sender.id) { request.controller.abort(); pending.delete(key) }
        })
      }
      return { ok: true, value: { state: 'ready', document: registration, active, meta: app.resource!.meta } }
    } catch (error) { return failure(error) }
  })
  ipcMain.handle(AgentIpcChannels.MCP_APP_RELEASE_DOCUMENT, (event, id: string) => {
    assertHost(event)
    resources.release(id, event.sender.id)
  })
  ipcMain.handle(AgentIpcChannels.MCP_APP_CANCEL_REQUEST, (event, context: McpAppDesktopRequestContext) => {
    assertHost(event)
    const request = pending.get(JSON.stringify([event.sender.id, context?.requestId]))
    if (request?.documentId === context?.documentId) request.controller.abort()
  })
  ipcMain.handle(AgentIpcChannels.MCP_APP_HOST_REQUEST, async (event, projectPath: string, sessionId: string, request: McpAppViewRequest, context?: McpAppDesktopRequestContext) => {
    let key: string | undefined
    try {
      assertHost(event)
      const sessionKey = mcpAppSessionKey(projectPath, sessionId)
      if (!context) {
        // Trusted shell loads a snapshot before creating the iframe, or activates a restored View.
        if (!['load', 'activate', 'sendPreparedMessage', 'removeModelContext'].includes(request.operation)) throw new McpAppsError('denied', 'MCP App document lease required')
        const { executeMcpAppHostRequest } = await import('./executor')
        return executeMcpAppHostRequest({ ...request, sessionKey }, { kind: 'desktop' })
      }
      if (typeof context.requestId !== 'string' || !context.requestId || context.requestId.length > 128 || typeof context.documentId !== 'string' || context.documentId.length > 128) throw new McpAppsError('invalid', 'MCP App document request identity required')
      const lease = resources.lease(context.documentId, event.sender.id, sessionKey, request.appInstanceId)
      const pendingKey = JSON.stringify([event.sender.id, context.requestId])
      if (pending.has(pendingKey)) throw new McpAppsError('denied', 'MCP App request is already running')
      if (pending.size >= 1024 || [...pending.values()].filter(value => value.documentId === context.documentId).length >= 32) throw new McpAppsError('denied', 'Too many concurrent MCP App requests')
      const controller = new AbortController()
      key = pendingKey
      pending.set(key, { owner: event.sender.id, documentId: context.documentId, controller })
      const { executeMcpAppHostRequest } = await import('./executor')
      return await executeMcpAppHostRequest({ ...request, sessionKey }, { kind: 'desktop' }, AbortSignal.any([lease.signal, controller.signal]), target => lease.validate(target.app))
    } catch (error) { return failure(error) }
    finally { if (key) pending.delete(key) }
  })
}
