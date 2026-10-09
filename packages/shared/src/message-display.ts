import type { ChatMessageContext, CollaborationMessageMeta, ContentBlock } from './agent-types'
import { safeImageUri } from './image-uri'

/** User-facing override, independent of the actual model input. */
export interface MessageDisplayFields {
  userMessageContent?: ContentBlock[]
  contexts?: ChatMessageContext[]
  /**
   * The message is a collaboration delivery (a parent's launch task). The host
   * that runs the session names where it came from, since a parent on another
   * machine has no session there to link.
   */
  collaboration?: { kind: 'initial_task'; fromSessionTitle?: string }
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
  if (input.collaboration !== undefined) {
    const collaboration = input.collaboration as Record<string, unknown> | null
    if (collaboration?.kind !== 'initial_task') throw new Error('Invalid collaboration delivery')
    result.collaboration = {
      kind: 'initial_task',
      ...(typeof collaboration.fromSessionTitle === 'string' && collaboration.fromSessionTitle ? { fromSessionTitle: collaboration.fromSessionTitle } : {}),
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) throw new Error('Message display exceeds the size limit')
  return result
}

/**
 * The chat metadata of a delivered launch task, as the local collaboration
 * path stores it, so every host renders it as "Task from <sender>".
 */
export function collaborationTaskMetadata(
  collaboration: MessageDisplayFields['collaboration'],
): { source: 'collaboration'; collaboration: CollaborationMessageMeta } | undefined {
  if (!collaboration) return undefined
  return { source: 'collaboration', collaboration: { ...collaboration, direction: 'inbound' } }
}
