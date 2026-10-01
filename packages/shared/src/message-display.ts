import type { ChatMessageContext, ContentBlock } from './agent-types'
import { safeImageUri } from './image-uri'

/** User-facing override, independent of the actual model input. */
export interface MessageDisplayFields {
  userMessageContent?: ContentBlock[]
  contexts?: ChatMessageContext[]
}

/** Validate the remote boundary without allowing callers to author arbitrary tool blocks. */
export function parseMessageDisplay(value: unknown): MessageDisplayFields {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result: MessageDisplayFields = {}
  if (input.userMessageContent !== undefined) {
    if (!Array.isArray(input.userMessageContent)) throw new Error('Invalid user message display content')
    result.userMessageContent = input.userMessageContent.map(value => {
      const block = value as Record<string, unknown> | null
      if (block?.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text }
      if ((block?.type === 'image' || block?.type === 'document') && typeof block.name === 'string') return { type: block.type, name: block.name, ...(typeof block.id === 'string' ? { id: block.id } : {}) }
      throw new Error('Unsupported user message display content')
    })
  }
  if (input.contexts !== undefined) {
    if (!Array.isArray(input.contexts)) throw new Error('Invalid message context attachments')
    result.contexts = input.contexts.map(value => {
      const item = value as Record<string, unknown> | null
      if (!item || ['appId', 'appName', 'summary', 'content'].some(key => typeof item[key] !== 'string')) throw new Error('Invalid message context attachment')
      const thumbnail = safeImageUri(item.thumbnail)
      return { appId: item.appId as string, appName: item.appName as string, summary: item.summary as string, content: item.content as string,
        ...(typeof item.color === 'string' ? { color: item.color } : {}), ...(thumbnail ? { thumbnail } : {}) }
    })
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) throw new Error('Message display exceeds the size limit')
  return result
}
