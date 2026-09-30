import type { McpAppMessage } from '@superone/shared/mcp-apps-state'
import { mcpAppMessageAttachments, mcpAppSessionApprovals } from '@superone/shared/mcp-apps-state'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsResolvedAttachment } from '@superone/shared/environment/mcp-apps-state-rpc'

/** Rebuild only after durable state changes; repeated View requests never transfer history. */
export class McpAppAttachmentIndex {
  private readonly sessions = new Map<string, { revision: string; apps: Map<string, Omit<McpAppsResolvedAttachment, 'projectId'>> }>()

  resolve(sessionId: string, appInstanceId: string, revision: string, catalog: () => readonly McpAppMessage[]): Omit<McpAppsResolvedAttachment, 'projectId'> {
    let entry = this.sessions.get(sessionId)
    if (entry?.revision !== revision) {
      const messages = catalog()
      const sessionApprovals = mcpAppSessionApprovals(messages)
      const apps = new Map<string, Omit<McpAppsResolvedAttachment, 'projectId'>>()
      for (const message of messages) for (const app of mcpAppMessageAttachments(message)) {
        apps.set(app.appInstanceId, { messageId: message.id, app, sessionApprovals })
      }
      entry = { revision, apps }
      this.sessions.set(sessionId, entry)
    }
    const target = entry.apps.get(appInstanceId)
    if (!target) throw new McpAppsError('denied', 'MCP App attachment was not found in this session')
    return target
  }

  delete(sessionId: string): void { this.sessions.delete(sessionId) }
}
