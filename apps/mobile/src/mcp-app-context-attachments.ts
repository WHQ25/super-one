import type { AgentEvent } from '@superone/shared/agent-types'
import type { RelayClient } from '@superone/relay-client'
import { findMcpAppAttachment, mcpAppContextSources, mcpAppEventAttachment, mergeMcpAppAttachment, restoreMcpAppContexts, type McpAppContextSource, type McpAppMessage } from '@superone/shared/mcp-apps-state'
import { mcpAppContextItems } from '@superone/shared/mcp-app-model-context'
import type { McpAppHostResult } from '@superone/shared/mcp-apps'
import { requestMcpApp } from './mcp-apps'

/** Composer state is independent of transcript pages. The host remains authoritative. */
export class McpAppContextAttachments {
  private sources?: McpAppContextSource[]
  restore(sources: McpAppContextSource[] | undefined): void { this.sources = sources }
  snapshot(): McpAppContextSource[] | undefined { return this.sources }
  reconcile<T extends McpAppMessage>(messages: readonly T[]): T[] {
    return this.sources !== undefined ? restoreMcpAppContexts(messages, this.sources) : [...messages]
  }
  items(messages: readonly McpAppMessage[]) {
    return (this.sources ?? mcpAppContextSources(messages)).flatMap(({ app, messageId }) => mcpAppContextItems(app, messageId))
  }
  capture(event: AgentEvent, messages: readonly McpAppMessage[]): void {
    const sources = this.sources ?? mcpAppContextSources(messages)
    let next: McpAppContextSource | undefined
    if (event.type === 'mcp_app_updated') {
      const previous = sources.find(value => value.app.appInstanceId === event.appInstanceId) ?? findMcpAppAttachment(messages, event.appInstanceId)
      if (previous) next = { ...previous, app: { ...previous.app, ...event.update } }
    } else {
      const app = mcpAppEventAttachment(event)
      if (app && 'messageId' in event && typeof event.messageId === 'string') {
        const previous = sources.find(value => value.app.appInstanceId === app.appInstanceId) ?? findMcpAppAttachment(messages, app.appInstanceId)
        // Native provider deltas cannot revive context absent from the complete host snapshot.
        const modelContext = this.sources !== undefined ? previous?.app.modelContext ?? null : mergeMcpAppAttachment(previous?.app, app)?.modelContext
        if (modelContext) next = { app: { ...app, modelContext }, messageId: event.messageId }
      }
    }
    if (next) {
      // Reuse the source projector to keep HTML and private tool results out of the phone cache.
      const compact = mcpAppContextSources([{ id: next.messageId, metadata: { codex: { items: [{ app: next.app }] } } }])
      this.sources = [...sources.filter(value => value.app.appInstanceId !== next!.app.appInstanceId), ...compact]
    }
  }
  async remove(id: string, client: Pick<RelayClient, 'request'>, session: { projectPath: string; sessionId: string }, messages: readonly McpAppMessage[]): Promise<void> {
    const item = this.items(messages).find(value => value.id === id)
    if (!item) throw new Error('Context attachment is unavailable')
    const response = await requestMcpApp(client, session, {
      operation: 'removeModelContext', appInstanceId: item.appInstanceId, messageId: item.messageId, updateId: item.updateId,
      ...(item.blockIndex !== undefined ? { blockIndex: item.blockIndex } : {}),
    }) as McpAppHostResult
    if (!response?.ok) throw new Error(response?.error.code === 'approval_required' ? 'Unexpected context approval' : response?.error.message ?? 'Could not remove context')
    // The durable event updates both composer and mounted View; never invent a local success state.
  }
}
