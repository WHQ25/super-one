import { McpAppsError, type McpAppApprovalPrompt, type McpAppHostOperation, type McpAppsCallResult, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { requestOpenExternalLink } from '@/lib/external-link'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'

export type McpAppDesktopApi = Pick<Window['environment'], 'mcpAppRegister' | 'mcpAppRelease' | 'mcpAppRequest' | 'mcpAppCancel' | 'onMcpAppDocumentRevoked' | 'mcpAppsAuthenticate'> & Partial<Pick<Window['environment'], 'onMcpAppEscape'>>
export interface McpAppRoute { projectPath: string; sessionId: string }
export type McpAppConsent = (prompt: McpAppApprovalPrompt, signal: AbortSignal) => Promise<Record<string, never> | null>

/** Only this trusted renderer adapter has access to preload. The iframe receives AppBridge. */
export function createDesktopMcpAppExecutor(options: {
  api: McpAppDesktopApi; route: McpAppRoute; app: ToolAppAttachment; document: McpAppDocumentRegistration
  consent: McpAppConsent; displayMode: McpAppHostExecutor['requestDisplayMode']
}): McpAppHostExecutor {
  const { api, route, app, document } = options
  const execute = async <T>(operation: McpAppHostOperation, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    const context = { documentId: document.id, requestId: crypto.randomUUID() }
    const cancel = () => { void api.mcpAppCancel(context).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    const request = { ...operation, appInstanceId: app.appInstanceId }
    try {
      let result = await api.mcpAppRequest(route.projectPath, route.sessionId, request, context)
      if (!result.ok && result.error.code === 'approval_required') {
        const approval = await options.consent(result.error.prompt, signal)
        if (!approval || signal.aborted) throw new McpAppsError(signal.aborted ? 'cancelled' : 'denied', 'MCP App request declined')
        // Consume the host's exact-operation challenge once; never loop or retry a tool call.
        result = await api.mcpAppRequest(route.projectPath, route.sessionId, { ...request, approval: { challenge: result.error.challenge, ...approval } }, context)
      }
      if (!result.ok) {
        if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'MCP App approval expired')
        throw new McpAppsError(result.error.code, result.error.message, result.error.challenge)
      }
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      return result.value as T
    } finally { signal.removeEventListener('abort', cancel) }
  }
  return {
    async callTool(request, signal) {
      try { return await execute<McpAppsCallResult>({ operation: 'callTool', ...request }, signal) }
      catch (error) {
        // A lost IPC reply may follow dispatch. Never offer automatic replay of a mutation.
        if (!(error instanceof McpAppsError) || error.code === 'unknown_outcome') return {
          outcome: 'unknown_outcome', result: { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'MCP App outcome is unknown' }] },
        }
        throw error
      }
    },
    readResource: (request, signal) => execute({ operation: 'readResource', ...request }, signal),
    sendMessage: async (params, signal) => { await execute({ operation: 'sendMessage', params }, signal); return {} },
    updateModelContext: async (context, signal) => { await execute({ operation: 'updateModelContext', context }, signal) },
    openLink: async ({ url }, signal) => {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App link cancelled')
      requestOpenExternalLink(url)
      return {}
    },
    requestDisplayMode: options.displayMode,
  }
}
