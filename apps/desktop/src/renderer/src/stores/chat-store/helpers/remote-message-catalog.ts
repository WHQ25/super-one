/**
 * Map node `session.messages.list` denser blocks into chat-store ChatMessage rows.
 * Used when remote hydrate can call listSessionMessages (gateway / future IPC).
 */
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import type { SessionMessageBlock } from '@superone/shared/environment'

/**
 * Prefer event-log ordered `content` (agent emission order). Fall back to
 * text + tools only for older nodes that do not populate `content`.
 */
function contentFromSessionMessageBlock(block: SessionMessageBlock): ContentBlock[] {
  if (Array.isArray(block.content) && block.content.length > 0) {
    return block.content.map((b) => ({ ...b })) as ContentBlock[]
  }
  const content: ContentBlock[] = []
  const text = typeof block.text === 'string' ? block.text : ''
  // Legacy fallback: without emission order, tools then text matches the common
  // agent pattern better than text-then-tools, but is still not authoritative.
  if (block.role === 'assistant' && Array.isArray(block.tools)) {
    for (const tool of block.tools) {
      content.push({
        type: 'tool_use',
        toolName: tool.toolName || 'tool',
        toolUseId: tool.toolUseId,
        input: tool.inputSummary ?? '',
        status: 'complete',
        ...(tool.parentToolUseId !== undefined
          ? { parentToolUseId: tool.parentToolUseId }
          : {}),
      })
      if (tool.outputSummary != null || tool.isError) {
        content.push({
          type: 'tool_result',
          toolUseId: tool.toolUseId,
          summary: tool.outputSummary ?? (tool.isError ? 'failed' : 'done'),
          ...(tool.isError ? { isError: true } : {}),
          ...(tool.parentToolUseId !== undefined
            ? { parentToolUseId: tool.parentToolUseId }
            : {}),
        })
      }
    }
  }
  if (text) content.push({ type: 'text', text })
  return content
}

export function sessionMessageBlocksToChatMessages(
  blocks: SessionMessageBlock[] | undefined,
  providerId = 'codex',
): ChatMessage[] {
  if (!Array.isArray(blocks)) return []
  const out: ChatMessage[] = []
  for (const block of blocks) {
    const role = block.role === 'assistant' || block.role === 'user' ? block.role : null
    if (!role) continue
    const content =
      role === 'user'
        ? (typeof block.text === 'string' && block.text
            ? ([{ type: 'text', text: block.text }] as ContentBlock[])
            : [])
        : contentFromSessionMessageBlock(block)
    out.push({
      id: block.id || crypto.randomUUID(),
      role,
      status: 'complete',
      content,
      createdAt: block.createdAt
        ? new Date(block.createdAt).toISOString()
        : new Date().toISOString(),
      providerId,
      ...(block.metadata ? { metadata: block.metadata as ChatMessage['metadata'] } : {}),
      ...(block.checkpointId ? { checkpointId: block.checkpointId } : {}),
      ...(block.resumePointId ? { resumePointId: block.resumePointId } : {}),
    })
  }
  return out
}

/**
 * Prefer denser catalog messages over text-only recovery when catalog is non-empty.
 * Local streamed messages still win on id match (richer content).
 */
export function preferCatalogMessages(
  localMessages: ChatMessage[],
  catalogMessages: ChatMessage[],
): ChatMessage[] {
  if (catalogMessages.length === 0) return localMessages
  if (localMessages.length === 0) return catalogMessages

  const localById = new Map(localMessages.map((m, i) => [m.id, i] as const))
  const usedLocal = new Set<number>()
  const result: ChatMessage[] = []

  for (const cat of catalogMessages) {
    const localAt = localById.get(cat.id)
    if (localAt !== undefined) {
      usedLocal.add(localAt)
      // Prefer local when it has more content blocks (streamed tools/thinking).
      const local = localMessages[localAt]!
      result.push(local.content.length >= cat.content.length ? local : cat)
    } else {
      result.push(cat)
    }
  }
  for (let i = 0; i < localMessages.length; i++) {
    if (!usedLocal.has(i)) result.push(localMessages[i]!)
  }
  return result
}
