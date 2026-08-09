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
 * Merge node denser catalog with local streamed messages.
 *
 * Backbone rule:
 * - When **local is at least as long** as catalog (typical switch back to an
 *   in-memory multi-turn session), keep **local chronological order** and only
 *   densify matching ids. Catalog-first used to treat a newest-page *suffix*
 *   as the full timeline and append early local turns at the end — early agent
 *   replies vanished from the head of the thread after session switch.
 * - When **catalog is longer** (cold open / local only has the latest turn),
 *   keep catalog order; local still wins on id match when richer.
 */
export function preferCatalogMessages(
  localMessages: ChatMessage[],
  catalogMessages: ChatMessage[],
): ChatMessage[] {
  if (catalogMessages.length === 0) return localMessages
  if (localMessages.length === 0) return catalogMessages

  const pickRicher = (local: ChatMessage, cat: ChatMessage): ChatMessage =>
    local.content.length >= cat.content.length ? local : cat

  // Local timeline is complete enough — preserve order, densify by id.
  if (localMessages.length >= catalogMessages.length) {
    const catById = new Map(catalogMessages.map((m) => [m.id, m] as const))
    const localIds = new Set(localMessages.map((m) => m.id))
    const result = localMessages.map((local) => {
      const cat = catById.get(local.id)
      return cat ? pickRicher(local, cat) : local
    })
    // Catalog-only assistants (stream gap) — append; skip catalog-only users
    // (node blockIds diverge from clientMessageId; local already has the bubble).
    for (const cat of catalogMessages) {
      if (localIds.has(cat.id)) continue
      if (cat.role === 'assistant') result.push(cat)
    }
    return result
  }

  // Catalog has more history than local — catalog order, richer local by id.
  const localById = new Map(localMessages.map((m, i) => [m.id, i] as const))
  const usedLocal = new Set<number>()
  const result: ChatMessage[] = []

  for (const cat of catalogMessages) {
    const localAt = localById.get(cat.id)
    if (localAt !== undefined) {
      usedLocal.add(localAt)
      result.push(pickRicher(localMessages[localAt]!, cat))
    } else {
      result.push(cat)
    }
  }
  for (let i = 0; i < localMessages.length; i++) {
    if (!usedLocal.has(i)) result.push(localMessages[i]!)
  }
  return result
}
