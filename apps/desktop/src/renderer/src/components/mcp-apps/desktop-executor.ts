import { McpAppsError, type McpAppApprovalPrompt, type McpAppHostOperation, type McpAppPreparedMessage, type McpAppsCallResult, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { requestOpenExternalLink } from '@/lib/external-link'
import { openFileTab } from '@/components/activity/activity-panel-api'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'

export type McpAppDesktopApi = Pick<Window['environment'], 'mcpAppRegister' | 'mcpAppRelease' | 'mcpAppRequest' | 'mcpAppCancel' | 'onMcpAppDocumentRevoked' | 'mcpAppsAuthenticate'> & Partial<Pick<Window['environment'], 'onMcpAppEscape' | 'onMcpAppResourceUpdated' | 'mcpAppCloseFile'>>
export interface McpAppRoute { projectPath: string; sessionId: string }
export type McpAppConsent = (prompt: McpAppApprovalPrompt, signal: AbortSignal) => Promise<Record<string, never> | null>

/** Only this trusted renderer adapter has access to preload. The iframe receives AppBridge. */
export function createDesktopMcpAppExecutor(options: {
  api: McpAppDesktopApi; route: McpAppRoute; app: ToolAppAttachment; document: McpAppDocumentRegistration
  consent: McpAppConsent; displayMode: McpAppHostExecutor['requestDisplayMode']
  navigate?(route: McpAppRoute): Promise<void>
}): McpAppHostExecutor {
  const { api, route, app, document } = options
  const execute = async <T>(operation: McpAppHostOperation, signal: AbortSignal, documentRequired = true): Promise<T> => {
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    const context = { documentId: document.id, requestId: crypto.randomUUID() }
    const cancel = () => { void api.mcpAppCancel(context).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    const request = { ...operation, appInstanceId: app.appInstanceId }
    try {
      let result = await api.mcpAppRequest(route.projectPath, route.sessionId, request, documentRequired ? context : undefined)
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
    subscribeResource: (request, signal) => execute({ operation: 'subscribeResource', ...request }, signal),
    unsubscribeResource: (request, signal) => execute({ operation: 'unsubscribeResource', ...request }, signal),
    writeResource: (params, signal) => execute({ operation: 'writeResource', params }, signal),
    sendMessage: async (params, signal) => {
      const result = await execute<Partial<McpAppPreparedMessage>>({ operation: 'sendMessage', params }, signal)
      if (result?.pendingSend && result.route) {
        if (!options.navigate) throw new McpAppsError('not_connected', 'New conversation navigation is unavailable')
        await options.navigate(result.route)
        // Navigation may unmount the original View. The confirmed single-use handoff
        // owns this send independently of that document's lifetime.
        await execute({ operation: 'sendPreparedMessage', pendingSend: result.pendingSend }, new AbortController().signal, false)
      }
      return {}
    },
    updateModelContext: (context, signal) => execute({ operation: 'updateModelContext', context }, signal),
    openLink: async ({ url }, signal) => {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App link cancelled')
      requestOpenExternalLink(url)
      return {}
    },
    openFile: async ({ path }, signal) => {
      // The host answers with the real path it checked (and, outside the project, the user confirmed).
      const result = await execute<{ path: string }>({ operation: 'openFile', path }, signal)
      openFileTab(result.path)
    },
    requestDisplayMode: options.displayMode,
  }
}
