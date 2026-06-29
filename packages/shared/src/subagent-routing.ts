import type { ContentBlock } from './agent-types'

/**
 * Helpers for re-attributing a resumed sub-agent's stream back to its original
 * Agent block. When a completed background sub-agent is woken (e.g. via the
 * SendMessage tool), the SDK streams its continuation into a NEW assistant
 * message tagged with the original Agent toolUseId as `parentToolUseId`, and
 * closes it with a task_notification whose `tool_use_id` is the waker's tool
 * call — only the shared `task_id` links it back. These helpers bridge that gap
 * so the renderer store and the main-process runtime both keep the resumed
 * content nested under its Agent block and re-open its running state.
 */

/** Find the id of the message that owns the tool_use block `toolUseId`. */
export function findToolUseMessageId(
  messages: Array<{ id: string; content: ContentBlock[] }>,
  toolUseId: string,
): string | undefined {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use' && block.toolUseId === toolUseId) return message.id
    }
  }
  return undefined
}

/**
 * Resolve the message a content delta should land in. A delta whose
 * `parentToolUseId` points at an Agent/tool block living in an *earlier*
 * message is re-homed there, so per-message grouping can reunite it with its
 * parent. Otherwise it stays in its own message.
 */
export function resolveDeltaHomeMessageId(
  messages: Array<{ id: string; content: ContentBlock[] }>,
  eventMessageId: string,
  delta: ContentBlock,
): string {
  const parentId = 'parentToolUseId' in delta ? delta.parentToolUseId : undefined
  if (!parentId) return eventMessageId
  const ownerId = findToolUseMessageId(messages, parentId)
  return ownerId && ownerId !== eventMessageId ? ownerId : eventMessageId
}

/**
 * Resolve the canonical toolUseId for a task lifecycle event. The direct
 * `toolUseId` wins when it is a tracked task; otherwise fall back to the entry
 * whose `taskId` matches (handles a resume notification that carries the
 * waker's toolUseId). Returns the direct id when nothing matches.
 */
export function resolveTaskToolUseId(
  taskProgress: Record<string, { taskId?: string }>,
  toolUseId: string | undefined,
  taskId: string | undefined,
): string | undefined {
  if (toolUseId && taskProgress[toolUseId]) return toolUseId
  if (taskId) {
    for (const key in taskProgress) {
      if (taskProgress[key].taskId === taskId) return key
    }
  }
  return toolUseId
}
