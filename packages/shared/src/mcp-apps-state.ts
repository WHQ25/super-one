import { validateMcpAppResource } from './mcp-app-resource'
import { compactMcpAppPresentation, MCP_APP_PRESENTATION_MAX_BYTES } from './mcp-apps-metadata'
import type { AgentEvent, ContentBlock, ImageAttachment } from './agent-types'
import { mcpAppContextInput, mcpAppContextItems, type McpAppContextAttachment } from './mcp-app-model-context'
import { validateTurnAttachments } from './attachment-validation'
import { assertMcpAppSize } from './mcp-apps'
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
    app.binding.configGeneration, app.binding.configFingerprint, app.binding.hostClient, app.resourceUri, app.origin?.providerSessionId, app.origin?.originCallId])
  if (identity(previous) !== identity(next)) return next
  return { ...next, resource: previous.resource ?? next.resource, modelContext: previous.modelContext !== undefined ? previous.modelContext : next.modelContext, presentation: previous.presentation ?? next.presentation }
}

/** Final provider snapshots may replace rows, but never host state on the same App origin. */
export function mergeMcpAppBlocks<B>(previous: readonly B[], next: readonly B[]): B[] {
  const apps = new Map(previous.flatMap(block => {
    const app = record(block).app as ToolAppAttachment | undefined
    return app ? [[app.appInstanceId, app] as const] : []
  }))
  const rows = new Map(previous.map(block => [record(block).id, block]))
  return next.map(block => {
    const value = record(block)
    const app = value.app as ToolAppAttachment | undefined
    if (app) return { ...block, app: mergeMcpAppAttachment(apps.get(app.appInstanceId), app) }
    // Completion snapshots can omit the extension entirely. Exact native item id
    // and type still identify the same call; never guess by server/tool/arguments.
    const previousRow = typeof value.id === 'string' ? record(rows.get(value.id)) : {}
    return previousRow.type === value.type && previousRow.app ? { ...block, app: previousRow.app } : block
  })
}

export function validateMcpAppAttachmentUpdate(update: McpAppAttachmentUpdate): void {
  if (update.resource) validateMcpAppResource(update.resource)
  assertMcpAppSize({ modelContext: update.modelContext })
  if (update.modelContext) {
    mcpAppContextInput({ appInstanceId: update.modelContext.source.appInstanceId, binding: { server: update.modelContext.source.server }, modelContext: update.modelContext } as ToolAppAttachment)
  }
  if (update.presentation) assertMcpAppSize(compactMcpAppPresentation(update.presentation), MCP_APP_PRESENTATION_MAX_BYTES)
}

/** Changes only existing attachments, preserving every provider-authored identity field. */
export function updateMcpAppAttachments<T extends McpAppMessage>(messages: readonly T[], appInstanceId: string, update: McpAppAttachmentUpdate): T[] {
  validateMcpAppAttachmentUpdate(update)
  const patch = { ...(update.resource ? { resource: update.resource } : {}),
    ...(update.modelContext !== undefined ? { modelContext: update.modelContext } : {}),
    ...(update.presentation ? { presentation: compactMcpAppPresentation(update.presentation) } : {}) }
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
  return mcpAppModelContextInput(messages).text
}

export interface McpAppContextSource { app: ToolAppAttachment; messageId: string }

function latestApps(messages: readonly McpAppMessage[]) {
  const entries = new Map<string, { app: ToolAppAttachment; messageId: string }>()
  for (const message of messages) for (const app of mcpAppMessageAttachments(message)) {
    entries.set(app.appInstanceId, { app, messageId: message.id })
  }
  return [...entries.values()]
}

/** References used by host GC; legacy inline snapshots remain untouched. */
export function mcpAppResourceHashes(messages: readonly McpAppMessage[]): Set<string> {
  return new Set(messages.flatMap(message => mcpAppMessageAttachments(message).flatMap(app => app.resource && /^[a-f0-9]{64}$/.test(app.resource.hash) ? [app.resource.hash] : [])))
}

/** Complete composer state independent of transcript pagination; never includes View HTML/tool output. */
export function mcpAppContextSources(messages: readonly McpAppMessage[]): McpAppContextSource[] {
  return latestApps(messages).filter(({ app }) => app.modelContext).map(({ app, messageId }) => ({ messageId,
    app: { appInstanceId: app.appInstanceId, binding: app.binding, resourceUri: app.resourceUri, status: app.status, modelContext: app.modelContext, ...(app.presentation ? { presentation: app.presentation } : {}) } }))
}

/** Complete state wins over old cached history, including authoritative clears. HTML stays fixed. */
export function restoreMcpAppContexts<T extends McpAppMessage>(messages: readonly T[], sources: readonly McpAppContextSource[]): T[] {
  const contexts = new Map(sources.map(source => [source.app.appInstanceId, source.app.modelContext]))
  let next = [...messages]
  for (const { app } of latestApps(messages)) next = updateMcpAppAttachments(next, app.appInstanceId, { modelContext: contexts.get(app.appInstanceId) ?? null })
  return next
}

export function mcpAppContextAttachments(messages: readonly McpAppMessage[], scheme?: 'light' | 'dark'): McpAppContextAttachment[] {
  return latestApps(messages).flatMap(({ app, messageId }) => mcpAppContextItems(app, messageId, scheme))
}

export function mcpAppModelContextInput(messages: readonly McpAppMessage[]): { text: string; images: ImageAttachment[] } {
  const entries: unknown[] = []
  const images: ImageAttachment[] = []
  for (const { app } of latestApps(messages)) {
    if (!app.modelContext) continue
    const input = mcpAppContextInput(app)
    images.push(...input.images)
    entries.push({ source: { appInstanceId: app.appInstanceId, server: app.binding.server },
      ...(input.text ? { text: input.text } : {}),
      ...(app.modelContext.structuredContent ? { structuredContent: app.modelContext.structuredContent } : {}) })
  }
  return { text: entries.length ? `<mcp-app-context>\n${JSON.stringify(entries)}\n</mcp-app-context>` : '', images }
}

/** One model-send boundary for desktop/phone commands and both headless runners. */
export function mcpAppModelInput<T extends { text: string; prompt?: string; images?: ImageAttachment[] }>(input: T, context: string | { text: string; images: ImageAttachment[] }): T {
  const data = typeof context === 'string' ? { text: context, images: [] } : context
  if (!data.text && !data.images.length) return input
  const images = [...(input.images ?? []), ...data.images]
  const text = data.text ? `${input.text}\n\n${data.text}` : input.text
  validateTurnAttachments(images, text)
  return { ...input, text, ...(images.length ? { images } : {}),
    ...(input.prompt !== undefined && data.text ? { prompt: `${input.prompt}\n\n${data.text}` } : {}) }
}

export function mcpAppEventAttachment(event: AgentEvent): ToolAppAttachment | undefined {
  if (event.type === 'content_delta' && 'app' in event.delta) return event.delta.app
  if (event.type === 'codex_item_delta' && event.item.type === 'mcp_tool_call') return event.item.app
  return undefined
}
