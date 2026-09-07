import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * i18n key for the label above a collaboration bubble, or null when the message
 * is ordinary user input. Shared so desktop and Remote Control agree on which
 * traffic counts as collaboration — `task-notification` does, and a surface that
 * only checks `source === 'collaboration'` silently drops it.
 */
export function collaborationLabelKey(message: ChatMessage): string | null {
  const source = message.metadata?.source
  if (source === 'task-notification') return 'chat.collaboration.taskNotification'
  if (source !== 'collaboration') return null
  const collab = message.metadata?.collaboration
  if (collab?.kind === 'initial_task') return 'chat.collaboration.initialTask'
  if (collab?.direction === 'outbound') return 'chat.collaboration.toAgent'
  return 'chat.collaboration.fromAgent'
}
