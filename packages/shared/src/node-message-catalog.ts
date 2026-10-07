/**
 * Map node `session.messages.list` denser blocks into chat-store ChatMessage rows.
 * Used when remote hydrate can call listSessionMessages (gateway / future IPC).
 */
import type { ChatMessage, ContentBlock } from './agent-types'
import type { SessionMessageBlock } from './environment/session-messages'

/**
 * Prefer event-log ordered `content` (agent emission order). Fall back to
 * text + tools only for older nodes that do not populate `content`.
 */
function contentFromSessionMessageBlock(block: SessionMessageBlock): ContentBlock[] {
  if (Array.isArray(block.content)) {
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
    const content = contentFromSessionMessageBlock(block)
    out.push({
      id: block.id || crypto.randomUUID(),
      role,
      status: 'complete',
      content,
      createdAt: block.createdAt
        ? new Date(block.createdAt).toISOString()
        : new Date().toISOString(),
      providerId,
      ...(block.contexts ? { contexts: block.contexts } : {}),
      ...(block.attachments ? { attachments: block.attachments } : {}),
      ...(block.metadata ? { metadata: block.metadata as ChatMessage['metadata'] } : {}),
      ...(block.checkpointId ? { checkpointId: block.checkpointId } : {}),
      ...(block.resumePointId ? { resumePointId: block.resumePointId } : {}),
    })
  }
  return out
}
