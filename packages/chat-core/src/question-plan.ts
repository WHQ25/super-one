import type { AgentEvent } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

type QuestionPlanEvent = Extract<AgentEvent, { type: 'ask_user_question' | 'plan_approval' }>

export function reduceQuestionPlan(_session: ChatCoreSession, event: QuestionPlanEvent): Partial<ChatCoreSession> {
  switch (event.type) {
    case 'ask_user_question':
      return { pendingQuestion: event.request }
    case 'plan_approval':
      return { pendingPlanApproval: event.request }
  }
}
