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

/** A title derived from text often restates the source the chip already shows. */
function withoutSourcePrefix(text: string, source: string): string {
  if (!source || text.slice(0, source.length).toLowerCase() !== source.toLowerCase()) return text
  const rest = text.slice(source.length)
  if (!/^[\s:·|,\-–—]/.test(rest)) return text
  return rest.replace(/^[\s:·|,\-–—]+/, '') || text
}

/**
 * Text that labels structured data (`selected view: {...}`) is titled by the
 * label alone; bare data by its field count. The data stays in the preview.
 */
function structuredTitle(text: string): { title: string } | { title: string; fields: number } | undefined {
  const start = text.search(/[{[]/)
  if (start < 0) return undefined
  let data: unknown
  try { data = JSON.parse(text.slice(start)) } catch { return undefined }
  if (!data || typeof data !== 'object') return undefined
  const label = text.slice(0, start).replace(/[\s:：·|,=\-–—]+$/, '').trim()
  if (label) return { title: label }
  const fields = Array.isArray(data) ? data.length : Object.keys(data).length
  return { title: `${fields} ${fields === 1 ? 'field' : 'fields'}`, fields }
}

export function mcpAppContextItems(app: ToolAppAttachment, messageId: string, scheme: 'light' | 'dark' = 'light'): McpAppContextAttachment[] {
  const state = mcpAppContextState(app)
  if (!state) return []
  const source = mcpAppServerTitle(app)
  const icon = mcpAppPresentationIcon(app.presentation, scheme)
  const base = { appInstanceId: app.appInstanceId, messageId, updateId: state.updateId, source, ...(icon ? { icon } : {}) }
  const previews = (images: ReturnType<typeof mcpAppContent>['images']) => images.filter(image => image.mimeType.startsWith('image/')).map(image => ({ src: `data:${image.mimeType};base64,${image.base64}`, alt: image.name }))
  const items = (state.content ?? []).flatMap((block, blockIndex) => {
    if (!mcpAppContextBlockVisible(block)) return []
    const data = mcpAppContent([block], source, `mcp:context:${app.appInstanceId}:${state.updateId}:${blockIndex}`)
    const item = data.items[0]
    const text = withoutSourcePrefix(data.text, source)
    const structured = item?.title ? undefined : structuredTitle(text)
    return [{ ...base, ...item, ...structured, id: `${app.appInstanceId}:${state.updateId}:${blockIndex}`, blockIndex,
      title: item?.title ?? structured?.title ?? (contextAttachmentPreview(text, 100) || `${source} context`),
      previewImages: previews(data.images),
      ...(data.images[0]?.mimeType.startsWith('image/') && !item?.thumbnail ? { thumbnail: previews(data.images)[0]?.src } : {}),
      ...(data.text ? { content: contextAttachmentPreview(data.text) } : {}) }]
  })
  if (items.length) return items
  if (!(state.content?.length || state.structuredContent)) return []
  const data = mcpAppContextInput(app)
  const payload = [data.text, ...data.images.map(image => `${image.name} (${image.mimeType})`), state.structuredContent ? JSON.stringify(state.structuredContent) : ''].filter(Boolean).join('\n')
  return [{ ...base, source: undefined, id: `${app.appInstanceId}:${state.updateId}:background`, title: `${source} context`,
    content: contextAttachmentPreview(payload), previewImages: previews(data.images) }]
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
