import type { AgentEvent, ChatMessage, HarnessId, Locale } from './agent-types'
import { getPendingReason } from './pending-interaction'
import { resources } from './i18n'

/** Small global sidebar summary; never includes tool inputs or transcript bodies. */
export interface SessionActivity {
  sessionId: string
  projectPath: string
  status: string
  provider: HarnessId
  acpAgentId?: string | null
  /** Latest finished assistant message, used by each client to track unread completions. */
  completedMessageId?: string | null
  pendingCount: number
  pendingReason: Record<Locale, string | null>
}

export function summarizeSessionActivity(
  snapshot: { id: string; projectPath: string; status: string; harnessId: HarnessId; acpAgentId?: string | null; messages?: readonly ChatMessage[] },
  interactions: AgentEvent[],
): SessionActivity {
  const permissions = interactions.flatMap(event => event.type === 'permission_request' ? [event.request] : [])
  const questions = interactions.flatMap(event => event.type === 'ask_user_question' ? [event.request] : [])
  const plans = interactions.flatMap(event => event.type === 'plan_approval' ? [event.request] : [])
  const reason = (locale: Locale) => getPendingReason(permissions, questions[0], plans[0], (key, options) => {
    let value: unknown = resources[locale].translation
    for (const part of key.split('.')) value = (value as Record<string, unknown> | undefined)?.[part]
    return (typeof value === 'string' ? value : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
  })
  return {
    sessionId: snapshot.id, projectPath: snapshot.projectPath, status: snapshot.status,
    provider: snapshot.harnessId, acpAgentId: snapshot.acpAgentId,
    ...(snapshot.messages ? { completedMessageId: lastCompletedMessageId(snapshot.messages) } : {}),
    pendingCount: new Set([...permissions.map(request => `permission:${request.requestId}`), ...questions.map(request => `question:${request.requestId}`), ...plans.map(request => `plan:${request.requestId}`)]).size,
    pendingReason: { en: reason('en'), zh: reason('zh') },
  }
}

export const SESSION_ACTIVITY_EVENTS: ReadonlySet<string> = new Set([
  'permission_request', 'ask_user_question', 'plan_approval', 'interaction_resolved',
  'status_change', 'message_interrupted', 'session_ended',
])

function lastCompletedMessageId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role === 'assistant' && message.status !== 'streaming') return message.id
  }
  return null
}
