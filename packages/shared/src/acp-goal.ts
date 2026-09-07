import type { SessionGoal } from './session-goal'

/**
 * Grok's `goal_updated` wire shape. Kept as its own type because it is what the
 * agent actually sends; render paths consume the harness-neutral `SessionGoal`
 * produced by {@link sessionGoalFromAcp}.
 */
export type AcpGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'budgetLimited'
  | 'complete'
  | 'cleared'

export interface AcpGoal {
  goalId: string
  objective: string
  status: AcpGoalStatus
  tokensUsed: number
  elapsedMs: number
  pauseMessage?: string
  phase?: string
}

/**
 * Map a Grok `goal_updated.status` wire string onto the host enum.
 * Unknown values restore as paused — never as a self-driving Active goal.
 */
export function normalizeAcpGoalStatus(raw: string): AcpGoalStatus {
  const status = raw.trim().toLowerCase().replace(/-/g, '_')
  switch (status) {
    case 'active':
      return 'active'
    case 'blocked':
      return 'blocked'
    case 'budget_limited':
    case 'budgetlimited':
      return 'budgetLimited'
    case 'complete':
    case 'completed':
      return 'complete'
    case 'cleared':
      return 'cleared'
    case 'user_paused':
    case 'backoff_paused':
    case 'back_off_paused':
    case 'no_progress_paused':
    case 'infra_paused':
    case 'paused':
      return 'paused'
    default:
      return 'paused'
  }
}

/**
 * Project a Grok goal onto the harness-neutral shape.
 *
 * `cleared` is a transition, not a state a goal can sit in, so it maps to "no
 * goal" rather than to a status the indicator would have to render.
 */
export function sessionGoalFromAcp(goal: AcpGoal | null | undefined): SessionGoal | null {
  if (!goal || goal.status === 'cleared') return null
  return {
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.tokensUsed,
    elapsedMs: goal.elapsedMs,
    ...(goal.pauseMessage ? { lastReason: goal.pauseMessage } : {}),
    ...(goal.phase ? { phase: goal.phase } : {}),
  }
}
