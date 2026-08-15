import type { AgentEvent, ChatMessage, TaskNotificationMeta } from '@superone/shared/agent-types'
import { resolveTaskToolUseId } from '@superone/shared/subagent-routing'

type TaskNotificationEvent = Extract<AgentEvent, { type: 'task_notification' }>

/** Minimal shape this module needs from `ClaudeSessionRuntime['taskProgress']`. */
type TaskProgressLike = Record<string, { taskId?: string; description?: string }>

/**
 * Host `browser_download` tasks already mint their own transcript bubble via
 * `Session.injectTaskNotification`, so a second row would double up.
 */
function isHostDownloadTask(taskId: string | undefined): boolean {
  return !!taskId && taskId.startsWith('bdl_')
}

function isUserTurn(message: ChatMessage): boolean {
  return message.role === 'user' && message.providerId !== 'system'
}

function currentTurnStartIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserTurn(messages[i])) return i
  }
  return 0
}

/**
 * True when the launching tool block is in the current user turn.
 * Earlier turns stay in the transcript but are usually scrolled away, so a
 * patched-in-place result there still looks like a reply from nowhere.
 */
function hasVisibleToolBlock(messages: readonly ChatMessage[], toolUseId: string | undefined): boolean {
  if (!toolUseId) return false
  const start = currentTurnStartIndex(messages)
  for (let i = start; i < messages.length; i++) {
    if (messages[i].content.some((block) => block.type === 'tool_use' && block.toolUseId === toolUseId)) {
      return true
    }
  }
  return false
}

function statusText(status: TaskNotificationMeta['status']): string {
  return status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'stopped'
}

/**
 * Build the compact "agent was notified" transcript row for a background-task
 * wake whose launching tool block is gone or only lives in an earlier turn.
 *
 * Both reducers ({@link applyClaudeEventToRuntime} and the renderer's `tool.ts`)
 * silently drop such a notification, so without this row the agent answers a
 * wake the user never saw. Returns `null` when the notification is already
 * visible in the current turn.
 *
 * The row is a `providerId: 'system'` assistant message so it stays out of
 * `extractClaudeTitle` (which titles a session from its first *user* message).
 * Its text block is plain prose on purpose: DB rows, transcript exports and the
 * mobile snapshot all read it directly, and only the desktop chat knows how to
 * render `metadata.taskNotification`.
 */
export function buildOrphanTaskNotificationMessage(
  event: TaskNotificationEvent,
  messages: readonly ChatMessage[],
  taskProgress: TaskProgressLike,
): ChatMessage | null {
  if (isHostDownloadTask(event.taskId)) return null

  const toolUseId = resolveTaskToolUseId(taskProgress, event.toolUseId, event.taskId)
  if (hasVisibleToolBlock(messages, toolUseId)) return null

  const description = (toolUseId ? taskProgress[toolUseId]?.description : undefined)?.trim() || undefined
  const summary = event.summary?.trim() || undefined
  const meta: TaskNotificationMeta = {
    status: event.taskStatus,
    ...(description ? { description } : {}),
    ...(summary ? { summary } : {}),
    ...(event.outputFile ? { outputFile: event.outputFile } : {}),
    ...(event.usage ? { usage: event.usage } : {}),
  }

  const text = [
    `Background task ${statusText(event.taskStatus)}`,
    description ? `: ${description}` : '',
    summary ? ` — ${summary}` : '',
  ].join('')

  return {
    id: `task_notify_${event.taskId || toolUseId || 'unknown'}_${Date.now().toString(36)}`,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'system',
    metadata: { taskNotification: meta },
  }
}
