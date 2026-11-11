import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { mcpAppServerTitle } from '@superone/shared/mcp-apps-metadata'
import {
  McpAppsError,
  type McpAppRequester,
  type McpAppToolResult,
  type McpAppsErrorCode,
} from '@superone/shared/mcp-apps'
import type {
  McpAppToolSurfaceRequest,
  McpAppToolSurfaceResponse,
  McpAppViewToolCatalog,
} from '@superone/shared/mcp-app-tools'
import { windowControlIpc } from '../session/control-context'
import {
  getMcpAppToolsRegistry,
  type McpAppToolApprovalOutcome,
  type McpAppToolsRegistry,
  type McpAppViewToolSurfaceDispatch,
} from './app-tools-registry'
import { mcpAppRequesterKey } from './executor-core'
import { mcpAppSessionKey } from './session-key'

interface PendingSurfaceRequest {
  senderKey: string
  kind: 'approve' | 'call'
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}

const VALID_ERROR_CODES = new Set<McpAppsErrorCode>([
  'auth_required',
  'inactive',
  'denied',
  'invalid',
  'not_connected',
  'timeout',
  'cancelled',
  'unknown_outcome',
])

export class McpAppToolSurfaceBridge {
  private readonly pending = new Map<string, PendingSurfaceRequest>()

  createDispatch(
    senderKey: string,
    sessionId: string,
    viewId: string,
    push: (request: McpAppToolSurfaceRequest) => void,
  ): McpAppViewToolSurfaceDispatch {
    return {
      requestApproval: (prompt, signal) =>
        this.sendRequest<McpAppToolApprovalOutcome>(
          senderKey,
          'approve',
          { kind: 'approve', sessionId, viewId, prompt },
          push,
          signal,
        ),
      callTool: (toolName, args, signal) =>
        this.sendRequest<McpAppToolResult>(
          senderKey,
          'call',
          { kind: 'call', sessionId, viewId, toolName, args },
          push,
          signal,
        ),
    }
  }

  respond(senderKey: string, response: McpAppToolSurfaceResponse): boolean {
    if (!response || typeof response.requestId !== 'string') return false
    const entry = this.pending.get(response.requestId)
    if (!entry || entry.senderKey !== senderKey || entry.kind !== response.kind) return false
    this.pending.delete(response.requestId)
    entry.cleanup()
    if (response.kind === 'approve') {
      entry.resolve({
        approved: response.approved === true,
        ...(response.alwaysAllow ? { alwaysAllow: true } : {}),
        ...(response.cancelled ? { cancelled: true } : {}),
      } satisfies McpAppToolApprovalOutcome)
      return true
    }
    if (response.ok) {
      entry.resolve(response.result)
      return true
    }
    const rawCode = response.error?.code as McpAppsErrorCode | undefined
    const code: McpAppsErrorCode = rawCode && VALID_ERROR_CODES.has(rawCode) ? rawCode : 'invalid'
    entry.reject(new McpAppsError(code, response.error?.message || 'MCP App tool execution failed'))
    return true
  }

  releaseSender(senderKey: string): void {
    for (const [requestId, entry] of [...this.pending]) {
      if (entry.senderKey !== senderKey) continue
      this.pending.delete(requestId)
      entry.cleanup()
      entry.reject(new McpAppsError('not_connected', 'MCP App surface disconnected'))
    }
  }

  private sendRequest<T>(
    senderKey: string,
    kind: 'approve' | 'call',
    payload: Omit<Extract<McpAppToolSurfaceRequest, { kind: 'approve' }>, 'requestId'>
      | Omit<Extract<McpAppToolSurfaceRequest, { kind: 'call' }>, 'requestId'>,
    push: (request: McpAppToolSurfaceRequest) => void,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new McpAppsError('cancelled', 'MCP App tool request cancelled'))
    }
    if (this.pending.size >= 512) {
      return Promise.reject(new McpAppsError('denied', 'Too many pending MCP App tool requests'))
    }
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID()
      const onAbort = () => {
        if (!this.pending.delete(requestId)) return
        try {
          push({ kind: 'cancel', requestId, sessionId: payload.sessionId, viewId: payload.viewId })
        } catch {}
        reject(new McpAppsError('cancelled', 'MCP App tool request cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      this.pending.set(requestId, {
        senderKey,
        kind,
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup,
      })
      try {
        push({ ...payload, requestId } as McpAppToolSurfaceRequest)
      } catch (error) {
        this.pending.delete(requestId)
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

const surfaceBridge = new McpAppToolSurfaceBridge()

export function getMcpAppToolSurfaceBridge(): McpAppToolSurfaceBridge {
  return surfaceBridge
}

export async function syncMcpAppSurfaceTools(input: {
  projectPath: string
  sessionId: string
  requester: McpAppRequester
  ownerId?: number
  senderKey: string
  viewId: string
  messageId?: string
  tools: unknown
  push: (request: McpAppToolSurfaceRequest) => void
  registry?: McpAppToolsRegistry
}): Promise<void> {
  const registry = input.registry ?? getMcpAppToolsRegistry()
  const sessionKey = mcpAppSessionKey(input.projectPath, input.sessionId)
  if (!input.viewId || typeof input.viewId !== 'string') {
    throw new McpAppsError('invalid', 'MCP App viewId is required')
  }
  if (Array.isArray(input.tools) && input.tools.length === 0) {
    registry.unregisterView(sessionKey, input.requester, input.viewId, input.ownerId)
    return
  }
  const { resolveMcpAppHostAttachment } = await import('./executor')
  const resolved = await resolveMcpAppHostAttachment({
    sessionKey,
    appInstanceId: input.viewId,
    messageId: input.messageId,
  })
  registry.syncView({
    sessionKey,
    projectScope: resolved.projectPath,
    requester: input.requester,
    ownerId: input.ownerId,
    catalog: {
      viewId: resolved.app.appInstanceId,
      server: resolved.app.binding.server,
      serverTitle: mcpAppServerTitle(resolved.app),
      originToolName: resolved.app.toolName,
      viewTitle: resolved.app.presentation?.toolTitle || resolved.app.toolName,
      tools: input.tools,
    },
    dispatch: surfaceBridge.createDispatch(input.senderKey, resolved.ref.sessionId, resolved.app.appInstanceId, input.push),
  })
}

export function listMcpAppToolsForSend(
  projectPath: string,
  sessionId: string,
  registry: McpAppToolsRegistry = getMcpAppToolsRegistry(),
): McpAppViewToolCatalog[] {
  return registry.listSessionViews(mcpAppSessionKey(projectPath, sessionId))
}

export function releaseMobileMcpAppToolSurface(deviceId: string): void {
  surfaceBridge.releaseSender(mcpAppRequesterKey({ kind: 'mobile', deviceId }))
}

function assertHost(event: IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new McpAppsError('denied', 'MCP App requests must come through the host renderer')
  }
}

export function registerMcpAppToolsIpc(registry: McpAppToolsRegistry = getMcpAppToolsRegistry()): void {
  const windowIpc = windowControlIpc(ipcMain)
  const owners = new Set<number>()

  windowIpc.handle(
    AgentIpcChannels.MCP_APP_TOOLS_SYNC,
    async (
      event,
      projectPath: string,
      sessionId: string,
      payload: { viewId: string; messageId?: string; tools: unknown },
    ) => {
      try {
        assertHost(event)
        const ownerId = event.sender.id
        const senderKey = `window:${ownerId}`
        if (!owners.has(ownerId)) {
          owners.add(ownerId)
          event.sender.once('destroyed', () => {
            owners.delete(ownerId)
            surfaceBridge.releaseSender(senderKey)
            registry.releaseWindowOwner(ownerId)
          })
        }
        await syncMcpAppSurfaceTools({
          projectPath,
          sessionId,
          requester: { kind: 'desktop' },
          ownerId,
          senderKey,
          viewId: payload?.viewId,
          messageId: payload?.messageId,
          tools: payload?.tools,
          push: (request) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('mcpApp:toolRequest', request)
            }
          },
          registry,
        })
        return { ok: true as const, value: null }
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof McpAppsError
            ? error.toJSON()
            : { code: 'invalid' as const, message: error instanceof Error ? error.message : String(error) },
        }
      }
    },
  )

  windowIpc.handle(
    AgentIpcChannels.MCP_APP_TOOLS_RESPOND,
    (event, response: McpAppToolSurfaceResponse) => {
      assertHost(event)
      return surfaceBridge.respond(`window:${event.sender.id}`, response)
    },
  )

  windowIpc.handle(
    AgentIpcChannels.MCP_APP_TOOLS_LIST_FOR_SEND,
    (event, projectPath: string, sessionId: string) => {
      assertHost(event)
      return listMcpAppToolsForSend(projectPath, sessionId, registry)
    },
  )
}
