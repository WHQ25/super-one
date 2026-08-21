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

/** Whole-arg `/goal` tokens Grok treats as lifecycle, not an objective. */
export const GROK_GOAL_LIFECYCLE_ARGS = ['status', 'pause', 'resume', 'clear'] as const

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

export function isGrokGoalLifecycleArg(args: string): boolean {
  return (GROK_GOAL_LIFECYCLE_ARGS as readonly string[]).includes(args.trim().toLowerCase())
}

export type GrokGoalComposerAction =
  | { type: 'dialog'; prefill: string }
  | { type: 'passthrough' }

/**
 * Decide whether a composer `/goal` line should open the host dialog or
 * pass through to Grok (lifecycle subcommands).
 */
export function grokGoalComposerAction(text: string): GrokGoalComposerAction | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  const args = match[1]?.trim() ?? ''
  if (isGrokGoalLifecycleArg(args)) return { type: 'passthrough' }
  return { type: 'dialog', prefill: args }
}
