import type { AgentEvent, ContentBlock } from './agent-types'
import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, McpAppsError } from './mcp-apps'
import type { McpAppAttachmentUpdate, ToolAppAttachment } from './mcp-apps'

/** Works with desktop transcripts and the node's denser message catalog. */
export interface McpAppMessage {
  id: string
  content?: ContentBlock[]
  metadata?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function mcpAppMessageAttachments(message: McpAppMessage): ToolAppAttachment[] {
  const items = record(record(message.metadata).codex).items
  const candidates: unknown[] = [...(message.content ?? []), ...(Array.isArray(items) ? items : [])]
  const apps = new Map<string, ToolAppAttachment>()
  for (const candidate of candidates) {
    const app = record(candidate).app as ToolAppAttachment | undefined
    if (app?.appInstanceId && app.binding && app.resourceUri) apps.set(app.appInstanceId, app)
  }
  return [...apps.values()]
}

export function findMcpAppAttachment(messages: readonly McpAppMessage[], appInstanceId: string, messageIdHint?: string): { messageId: string; app: ToolAppAttachment } | undefined {
  const hinted = messageIdHint ? messages.find(message => message.id === messageIdHint) : undefined
  const hintedApp = hinted && mcpAppMessageAttachments(hinted).find(app => app.appInstanceId === appInstanceId)
  if (hinted && hintedApp) return { messageId: hinted.id, app: hintedApp }
  for (const message of messages) {
    const app = mcpAppMessageAttachments(message).find(value => value.appInstanceId === appInstanceId)
    if (app) return { messageId: message.id, app }
  }
  return undefined
}

/** Keep host state when a native provider sends the next input/result delta. */
export function mergeMcpAppAttachment(previous: ToolAppAttachment | undefined, next: ToolAppAttachment | undefined): ToolAppAttachment | undefined {
  if (!previous || !next || previous.appInstanceId !== next.appInstanceId) return next ?? previous
  const identity = (app: ToolAppAttachment): string => JSON.stringify([app.binding.node, app.binding.session, app.binding.server, app.binding.account,
    app.binding.configGeneration, app.binding.configFingerprint, app.resourceUri, app.origin?.providerSessionId, app.origin?.originCallId])
  if (identity(previous) !== identity(next)) return next
  return { ...next, resource: previous.resource ?? next.resource, modelContext: previous.modelContext ?? next.modelContext }
}

export function validateMcpAppAttachmentUpdate(update: McpAppAttachmentUpdate): void {
  if (update.resource) {
    if (typeof update.resource.html !== 'string' || new TextEncoder().encode(update.resource.html).byteLength > MCP_APP_HTML_MAX_BYTES) {
      throw new McpAppsError('invalid', 'MCP App HTML exceeds the size limit')
    }
    assertMcpAppSize({ meta: update.resource.meta, hash: update.resource.hash })
  }
  assertMcpAppSize({ modelContext: update.modelContext })
}

/** Changes only existing attachments, preserving every provider-authored identity field. */
export function updateMcpAppAttachments<T extends McpAppMessage>(messages: readonly T[], appInstanceId: string, update: McpAppAttachmentUpdate): T[] {
  validateMcpAppAttachmentUpdate(update)
  const patch = { ...(update.resource ? { resource: update.resource } : {}),
    ...(update.modelContext ? { modelContext: update.modelContext } : {}) }
  const replace = <B>(block: B): B => {
    const app = record(block).app as ToolAppAttachment | undefined
    if (app?.appInstanceId !== appInstanceId) return block
    return { ...block, app: { ...app, ...patch } }
  }
  return messages.map(message => {
    if (!mcpAppMessageAttachments(message).some(app => app.appInstanceId === appInstanceId)) return message
    const metadata = record(message.metadata)
    const codex = record(metadata.codex)
    return { ...message, ...(message.content ? { content: message.content.map(replace) } : {}),
      ...(Array.isArray(codex.items) ? { metadata: { ...metadata, codex: { ...codex, items: codex.items.map(replace) } } } : {}) }
  })
}

/** Model-only context: latest entry per View, with host-authored source attribution. */
export function mcpAppModelContextText(messages: readonly McpAppMessage[]): string {
  const entries = new Map<string, unknown>()
  for (const message of messages) for (const app of mcpAppMessageAttachments(message)) {
    if (app.modelContext) entries.set(app.appInstanceId, {
      source: { appInstanceId: app.appInstanceId, server: app.binding.server },
      ...(app.modelContext.content ? { content: app.modelContext.content } : {}),
      ...(app.modelContext.structuredContent ? { structuredContent: app.modelContext.structuredContent } : {}),
    })
  }
  return entries.size ? `<mcp-app-context>\n${JSON.stringify([...entries.values()])}\n</mcp-app-context>` : ''
}

/** One model-send boundary for desktop/phone commands and both headless runners. */
export function mcpAppModelInput<T extends { text: string; prompt?: string }>(input: T, context: string): T {
  if (!context) return input
  return { ...input, text: `${input.text}\n\n${context}`,
    ...(input.prompt !== undefined ? { prompt: `${input.prompt}\n\n${context}` } : {}) }
}

export function mcpAppEventAttachment(event: AgentEvent): ToolAppAttachment | undefined {
  if (event.type === 'content_delta' && 'app' in event.delta) return event.delta.app
  if (event.type === 'codex_item_delta' && event.item.type === 'mcp_tool_call') return event.item.app
  return undefined
}
