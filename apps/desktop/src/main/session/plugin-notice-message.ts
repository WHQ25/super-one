import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

type PluginLogEvent = Extract<AgentEvent, { type: 'plugin_notice' }> & { kind: 'log'; text: string }

export function isPluginLogEvent(event: AgentEvent): event is PluginLogEvent {
  return event.type === 'plugin_notice' && event.kind === 'log' && !!event.text
}

/**
 * Build the transcript notice row for a plugin's `log` line.
 *
 * Like the model-fallback row, it is a `providerId: 'system'` assistant message:
 * it keeps its place among the turns it was written beside, survives reloads and
 * reaches mobile through `user_message_appended`, and stays out of session
 * titles. The text block is the plugin's line alone; who wrote it lives in
 * `metadata.pluginNotice`.
 */
export function buildPluginNoticeMessage(event: PluginLogEvent): ChatMessage {
  return {
    id: `plugin_notice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: event.text }],
    createdAt: new Date().toISOString(),
    providerId: 'system',
    metadata: { pluginNotice: { plugin: event.plugin, ...(event.level ? { level: event.level } : {}) } },
  }
}
