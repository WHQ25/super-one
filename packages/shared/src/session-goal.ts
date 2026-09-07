/**
 * Harness-neutral session goal.
 *
 * Three harnesses ship a "goal" and none of them mean quite the same thing:
 *
 * - **Codex** — an `objective` held by the app-server (`thread/goal/*`), with a
 *   token budget. SuperOne drives the follow-up turns itself.
 * - **Grok** — an `objective` the agent pursues on its own, pushed back over ACP
 *   `goal_updated`.
 * - **Claude** — a completion *condition* checked by a Stop hook. There is no
 *   pause state: the goal either exists (still being pursued) or it is gone.
 *
 * `SessionGoal` is the intersection every surface can render, plus the optional
 * fields a harness genuinely reports. Absent means "this harness does not report
 * it" — never "zero". Which optional fields to expect is declared per harness in
 * `HarnessCapabilities.goal`, so render paths ask the capability rather than the
 * harness id.
 */

export type SessionGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export interface SessionGoal {
  /** What the session is working toward. Claude's `condition` maps here. */
  objective: string
  status: SessionGoalStatus
  /** Tokens spent pursuing the goal so far. */
  tokensUsed?: number
  /** Wall-clock spent pursuing the goal so far. */
  elapsedMs?: number
  /** Codex: cap after which the goal self-limits. `null` = uncapped. */
  tokenBudget?: number | null
  /** Claude: how many times the evaluator has run without the condition being met. */
  iterations?: number
  /** Why the goal is not done yet — Claude's `last_reason`, Grok's `pauseMessage`. */
  lastReason?: string
  /** Grok: agent-reported stage label. */
  phase?: string
}

const SESSION_GOAL_STATUSES: readonly SessionGoalStatus[] = [
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
]

/**
 * Map an unknown wire status onto the host enum.
 *
 * Unknown values restore as `paused`, never as a self-driving `active` goal — a
 * status we failed to understand must not read as "keep going".
 */
export function normalizeSessionGoalStatus(raw: unknown): SessionGoalStatus {
  if (typeof raw !== 'string') return 'paused'
  const status = raw.trim().toLowerCase().replace(/[-_]/g, '')
  const match = SESSION_GOAL_STATUSES.find((s) => s.toLowerCase() === status)
  return match ?? 'paused'
}

/** Shape of `SDKActiveGoalMessage.value` — the Claude Stop-hook goal snapshot. */
export interface ClaudeActiveGoalValue {
  condition: string
  iterations: number
  set_at: number
  tokens_at_start: number
  last_reason?: string
}

/**
 * Map Claude's `active_goal` payload onto the host goal.
 *
 * A present value always means the condition is still unmet — Claude clears the
 * goal (value `null`) the moment its evaluator reports met — so the status is
 * `active` by construction rather than read from the wire.
 *
 * `set_at` / `tokens_at_start` are deliberately dropped: they are start markers,
 * and turning them into an elapsed/used figure would require a "now" the mapper
 * does not own.
 */
export function sessionGoalFromClaudeActive(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<ClaudeActiveGoalValue>
  const condition = typeof value.condition === 'string' ? value.condition.trim() : ''
  if (!condition) return null
  const lastReason = typeof value.last_reason === 'string' ? value.last_reason.trim() : ''
  return {
    objective: condition,
    status: 'active',
    ...(typeof value.iterations === 'number' && Number.isFinite(value.iterations)
      ? { iterations: value.iterations }
      : {}),
    ...(lastReason ? { lastReason } : {}),
  }
}

export type GoalComposerAction =
  | { type: 'dialog'; prefill: string }
  | { type: 'passthrough' }

/**
 * Decide what a composer `/goal …` line should do.
 *
 * Whole-arg tokens the harness handles itself (`pause`, `clear`, …) pass through
 * as plain text; anything else is an objective and opens the host dialog. The
 * token list is per harness — Claude has only `clear`, Grok has four, Codex none
 * — so it comes from `HarnessCapabilities.goal.lifecycleArgs`.
 *
 * Returns `null` when the line is not a `/goal` line at all.
 */
export function goalComposerAction(
  text: string,
  lifecycleArgs: readonly string[],
): GoalComposerAction | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  const args = match[1]?.trim() ?? ''
  if (isGoalLifecycleArg(args, lifecycleArgs)) return { type: 'passthrough' }
  return { type: 'dialog', prefill: args }
}

/** True when the whole argument (not a prefix of it) is a lifecycle token. */
export function isGoalLifecycleArg(args: string, lifecycleArgs: readonly string[]): boolean {
  const normalized = args.trim().toLowerCase()
  return normalized.length > 0 && lifecycleArgs.includes(normalized)
}
