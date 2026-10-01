import type { ChatMessageContext, ContentBlock, ImageAttachment } from './agent-types'
import { McpAppsError, type McpAppMessageParams } from './mcp-apps'
import { mcpAppIcon } from './mcp-apps-metadata'
import { contextAttachmentPreview, type ContextAttachment } from './context-attachments'
import { validateTurnAttachments } from './attachment-validation'
import { parseMessageDisplay } from './message-display'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}

export function mcpAppMessageTarget(params: McpAppMessageParams): 'active' | 'new' {
  const options = record(params._meta?.['openai/message'])
  if (params._meta?.['openai/message'] !== undefined && (typeof params._meta['openai/message'] !== 'object' || params._meta['openai/message'] === null || Array.isArray(params._meta['openai/message']))) throw new McpAppsError('invalid', 'Invalid openai/message options')
  if (Object.keys(options).some(key => key !== 'target' && key !== 'send') || (options.send !== undefined && options.send !== true) || (options.target !== undefined && options.target !== 'active' && options.target !== 'new')) throw new McpAppsError('invalid', 'Only immediate MCP App messages to active or new sessions are supported')
  return options.target === 'new' ? 'new' : 'active'
}

/** Project protocol blocks into real model input and plain, labeled user-facing items.
 * No protocol metadata or annotations enter the model text. */
export function mcpAppContent(content: unknown[], source: string, idPrefix: string, hideAssistant = false): {
  text: string; images: ImageAttachment[]; userMessageContent: ContentBlock[]; contexts: ChatMessageContext[]; items: ContextAttachment[]
} {
  const text: string[] = []
  const images: ImageAttachment[] = []
  const display: ContentBlock[] = []
  const contexts: ChatMessageContext[] = []
  const items: ContextAttachment[] = []
  for (const [index, value] of content.entries()) {
    const block = record(value)
    const meta = record(block._meta)
    const title = typeof meta['openai/title'] === 'string' ? meta['openai/title'].slice(0, 512) : undefined
    const thumbnail = mcpAppIcon([{ src: String(record(meta['openai/thumbnail']).src ?? '') }])
    const id = `${idPrefix}:${index}`
    let body: string
    let image: ImageAttachment | undefined
    switch (block.type) {
      case 'text':
        if (typeof block.text !== 'string') throw new McpAppsError('invalid', 'Invalid MCP App text')
        body = block.text
        break
      case 'image':
        if (typeof block.data !== 'string' || typeof block.mimeType !== 'string') throw new McpAppsError('invalid', 'Invalid MCP App image')
        image = { name: title || 'MCP App image', mimeType: block.mimeType, base64: block.data }
        body = ''
        break
      case 'resource_link':
        if (typeof block.uri !== 'string') throw new McpAppsError('invalid', 'Invalid MCP App resource link')
        body = [typeof block.name === 'string' ? block.name : '', block.uri, typeof block.description === 'string' ? block.description : ''].filter(Boolean).join('\n')
        break
      case 'resource': {
        const resource = record(block.resource)
        if (typeof resource.uri !== 'string') throw new McpAppsError('invalid', 'Invalid MCP App embedded resource')
        if (typeof resource.text === 'string') body = `${resource.uri}\n${resource.text}`
        else if (typeof resource.blob === 'string') {
          if (typeof resource.mimeType === 'string' && (resource.mimeType.startsWith('image/') || resource.mimeType === 'application/pdf')) {
            image = { name: title || resource.uri, mimeType: resource.mimeType, base64: resource.blob }
            body = resource.uri
          } else body = JSON.stringify({ uri: resource.uri, ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}), blob: resource.blob })
        } else throw new McpAppsError('invalid', 'MCP App embedded resource needs text or a blob')
        break
      }
      default: throw new McpAppsError('invalid', `MCP App content ${String(block.type)} is not supported`)
    }
    if (body) text.push(body)
    if (image) { image.id = id; images.push(image) }
    const hidden = Array.isArray(record(block.annotations).audience) && (record(block.annotations).audience as unknown[]).length === 1 && (record(block.annotations).audience as unknown[])[0] === 'assistant'
    if (hideAssistant && hidden) continue
    if (title || block.type !== 'text') {
      const label = title || (block.type === 'resource_link' && typeof block.name === 'string' ? block.name : image?.name || 'Resource')
      const item: ContextAttachment = { id, title: label, source, ...(body ? { content: body } : {}), ...(thumbnail ? { thumbnail } : {}) }
      items.push(item)
      if (image) display.push({ type: image.mimeType === 'application/pdf' ? 'document' : 'image', name: image.name, id })
      else contexts.push({ appId: id, appName: source, summary: label, content: body, ...(thumbnail ? { thumbnail } : {}) })
    } else display.push({ type: 'text', text: body })
  }
  const modelText = text.join('\n')
  try { validateTurnAttachments(images, modelText) } catch (error) { throw new McpAppsError('invalid', error instanceof Error ? error.message : 'Invalid MCP App attachments') }
  try { parseMessageDisplay({ userMessageContent: display, contexts }) } catch (error) { throw new McpAppsError('invalid', error instanceof Error ? error.message : 'Invalid MCP App display') }
  return { text: modelText, images, userMessageContent: display, contexts, items }
}

/** Keep confirmation previews small; the exact unmodified request remains challenge-bound. */
export function mcpAppMessagePreview(params: McpAppMessageParams, server: string) {
  const content = mcpAppContent(params.content, server, 'preview')
  return { text: contextAttachmentPreview(content.userMessageContent.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')),
    items: content.items.map(item => ({ ...item, content: item.content ? contextAttachmentPreview(item.content) : undefined })),
    nonTextBlocks: 0, target: mcpAppMessageTarget(params) }
}
