import type { McpAppsPort } from '@superone/runtime/server'
import { hydrateMcpAppResource, mcpAppStatePatch } from '@superone/runtime/mcp-apps/attachment-state'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppResourceStore } from '@superone/shared/mcp-app-resource'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import type { Session } from '../session/types'

export interface DesktopMcpAppsDeps {
  /** The live session, resumed when it is cold. */
  session(sessionId: string): Session
  projectId(sessionId: string): string
  /** The window's MCP App HTML store; without it HTML stays inline. */
  resources?: () => McpAppResourceStore
}

/**
 * This desktop's sessions' MCP Apps as the node contract serves them, over the
 * same transcript, host events and session providers the window's executor
 * uses (`mcp-apps/executor.ts`). The desktop binds its sessions' Apps to
 * `local`, its own name for itself, so a client sends that binding back as is.
 */
export function createDesktopMcpAppsPort(deps: DesktopMcpAppsDeps): McpAppsPort {
  const resolve = (sessionId: string, appInstanceId: string) => {
    const session = deps.session(sessionId)
    const target = findMcpAppAttachment(session.snapshot.messages, appInstanceId)
    if (!target || target.app.binding.node !== 'local' || target.app.binding.session !== sessionId) throw new McpAppsError('denied', 'MCP App attachment does not belong to this session')
    return { session, target: { ...target, projectId: deps.projectId(sessionId) } }
  }
  return {
    resolveMcpAppAttachment: (sessionId, appInstanceId) => resolve(sessionId, appInstanceId).target,
    loadMcpAppResource: (sessionId, appInstanceId) => hydrateMcpAppResource(resolve(sessionId, appInstanceId).target.app, deps.resources?.()),
    updateMcpApp(sessionId, appInstanceId, update) {
      const { session, target } = resolve(sessionId, appInstanceId)
      const patch = mcpAppStatePatch(target.app, update, deps.resources?.())
      session.emitHostEvent({ type: 'mcp_app_updated', sessionId, projectPath: session.projectPath, messageId: target.messageId, appInstanceId, update: patch })
    },
    async getMcpAppsProvider(binding, origin) {
      const session = deps.session(binding.session)
      if (!session.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
      return session.getMcpAppsProvider(binding, origin)
    },
  }
}
