import type { ContextAttachment } from './context-attachments'
import { contextAttachmentPreview } from './context-attachments'
import { mcpAppContent } from './mcp-apps-content'
import { mcpAppPresentationIcon, mcpAppServerTitle } from './mcp-apps-metadata'
import type { McpAppModelContext, ToolAppAttachment } from './mcp-apps'
import { McpAppsError } from './mcp-apps'

export type McpAppModelContextState = (Omit<McpAppModelContext, 'source' | 'updateId'> & { updateId: string }) | null
export interface McpAppContextAttachment extends ContextAttachment {
  appInstanceId: string
  messageId: string
  updateId: string
  blockIndex?: number
}

export function mcpAppContextState(app: ToolAppAttachment): McpAppModelContextState {
  const value = app.modelContext
  return value ? { updateId: value.updateId || `legacy:${app.appInstanceId}`,
    ...(value.content ? { content: value.content } : {}),
    ...(value.structuredContent ? { structuredContent: value.structuredContent } : {}) } : null
}

export function mcpAppContextBlockVisible(block: unknown): boolean {
  const audience = (block as { annotations?: { audience?: unknown } } | null)?.annotations?.audience
  return !(Array.isArray(audience) && audience.length === 1 && audience[0] === 'assistant')
}

/** All model input is projected through the same metadata-free content contract. */
export function mcpAppContextInput(app: ToolAppAttachment) {
  return mcpAppContent(app.modelContext?.content ?? [], mcpAppServerTitle(app), `mcp:context:${app.appInstanceId}:${mcpAppContextState(app)?.updateId ?? ''}`)
}

export function mcpAppContextItems(app: ToolAppAttachment, messageId: string, scheme: 'light' | 'dark' = 'light'): McpAppContextAttachment[] {
  const state = mcpAppContextState(app)
  if (!state) return []
  const source = mcpAppServerTitle(app)
  const base = { appInstanceId: app.appInstanceId, messageId, updateId: state.updateId, source }
  const previews = (images: ReturnType<typeof mcpAppContent>['images']) => images.filter(image => image.mimeType.startsWith('image/')).map(image => ({ src: `data:${image.mimeType};base64,${image.base64}`, alt: image.name }))
  const items = (state.content ?? []).flatMap((block, blockIndex) => {
    if (!mcpAppContextBlockVisible(block)) return []
    const data = mcpAppContent([block], source, `mcp:context:${app.appInstanceId}:${state.updateId}:${blockIndex}`)
    const item = data.items[0]
    return [{ ...base, ...item, id: `${app.appInstanceId}:${state.updateId}:${blockIndex}`, blockIndex,
      title: item?.title ?? (contextAttachmentPreview(data.text, 100) || `${source} context`),
      previewImages: previews(data.images),
      ...(data.images[0]?.mimeType.startsWith('image/') && !item?.thumbnail ? { thumbnail: previews(data.images)[0]?.src } : {}),
      ...(data.text ? { content: contextAttachmentPreview(data.text) } : {}) }]
  })
  if (items.length) return items
  if (!(state.content?.length || state.structuredContent)) return []
  const data = mcpAppContextInput(app)
  const payload = [data.text, ...data.images.map(image => `${image.name} (${image.mimeType})`), state.structuredContent ? JSON.stringify(state.structuredContent) : ''].filter(Boolean).join('\n')
  return [{ ...base, source: undefined, id: `${app.appInstanceId}:${state.updateId}:background`, title: `${source} context`,
    content: contextAttachmentPreview(payload), previewImages: previews(data.images), thumbnail: mcpAppPresentationIcon(app.presentation, scheme) }]
}

/** A stale chip must never remove a newer replacement. Last visible removal clears background too. */
export function removeMcpAppContextBlock(app: ToolAppAttachment, updateId: string, blockIndex?: number): McpAppModelContext | null {
  const state = mcpAppContextState(app)
  if (!state || state.updateId !== updateId) throw new McpAppsError('invalid', 'MCP App context changed; refresh the attachment')
  if (blockIndex === undefined) return null
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || !state.content || blockIndex >= state.content.length || !mcpAppContextBlockVisible(state.content[blockIndex])) throw new McpAppsError('invalid', 'MCP App context attachment is unavailable')
  const content = state.content.filter((_, index) => index !== blockIndex)
  if (!content.some(mcpAppContextBlockVisible)) return null
  return { ...app.modelContext!, content }
}
