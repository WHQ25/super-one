import type { AgentEvent, ChatMessage, CodexGoal } from '@superone/shared/agent-types'
import { sessionGoalFromCodex } from './codex-goal-service'

/** Goal RPCs start a conversation without going through a normal user send. */
export function codexGoalEventCallbacks(
  emit: (event: AgentEvent) => void,
  publishThread: (threadId: string) => void,
) {
  return {
    onGoalChange: (goal: CodexGoal | null) => {
      // Persist the thread before the accepted user row, including on a fresh
      // session whose prewarmed thread has not run an explicit turn yet.
      if (goal) publishThread(goal.threadId)
      emit({ type: 'session_goal', goal: sessionGoalFromCodex(goal) })
    },
    onUserMessage: (message: ChatMessage) => {
      emit({ type: 'user_message_appended', message })
    },
  }
}
