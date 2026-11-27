import type { AgentEvent, SessionGoal } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { goalComposerAction } from '@superone/shared/session-goal'

const ANTIGRAVITY_GOAL_LIFECYCLE = HARNESS_CAPABILITIES['acp-antigravity'].goal!.lifecycleArgs
const GOAL_CANCELLED_MARKER = '<!-- GOAL_CANCELLED -->'

export class AntigravityGoalTracker {
  private goal: SessionGoal | null = null
  private tail = ''
  private sawCancelledMarker = false

  noteSend(content: string): AgentEvent[] {
    this.tail = ''
    this.sawCancelledMarker = false
    const action = goalComposerAction(content, ANTIGRAVITY_GOAL_LIFECYCLE)
    if (action?.type === 'set') {
      this.goal = { objective: action.objective, status: 'active' }
      return [{ type: 'session_goal', goal: this.goal }]
    }
    return []
  }

  reconcile(event: AgentEvent): AgentEvent[] {
    if (this.goal?.status !== 'active') return [event]

    if (event.type === 'content_delta' && event.delta.type === 'text') {
      this.tail = (this.tail + event.delta.text).slice(-64)
      if (this.tail.includes(GOAL_CANCELLED_MARKER)) {
        this.sawCancelledMarker = true
      }
      return [event]
    }

    if (event.type === 'message_complete') {
      this.tail = ''
      if (this.sawCancelledMarker) {
        this.sawCancelledMarker = false
        this.goal = null
        return [event, { type: 'session_goal', goal: null }]
      }
      this.goal = { ...this.goal, status: 'complete' }
      return [event, { type: 'session_goal', goal: this.goal }]
    }

    if (event.type === 'message_interrupted' || event.type === 'message_error') {
      this.tail = ''
      this.sawCancelledMarker = false
      this.goal = null
      return [event, { type: 'session_goal', goal: null }]
    }

    return [event]
  }
}
