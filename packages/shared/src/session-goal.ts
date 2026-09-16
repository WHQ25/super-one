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

import { ALL_GOAL_LIFECYCLE_ARGS } from './harness/harness-capabilities'

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
  /** Why the goal is not done yet — Claude's `last_reason`, Grok's `pauseMessage`. */
  lastReason?: string
  /** Grok: agent-reported stage label. */
  phase?: string
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
 * `set_at` / `tokens_at_start` / `iterations` are deliberately dropped: the first
 * two are start markers, and turning them into an elapsed/used figure would
 * require a "now" the mapper does not own. `iterations` counts evaluator passes,
 * which no surface reports — the goal is either still being pursued or it is not.
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
    ...(lastReason ? { lastReason } : {}),
  }
}

export type GoalComposerAction =
  | { type: 'compose' }
  | { type: 'set'; objective: string }
  | { type: 'passthrough' }

/**
 * Decide what a composer `/goal …` line should do.
 *
 * A bare `/goal` enters goal mode — the composer's next send becomes the
 * objective. `/goal <text>` sets it right away. Whole-arg tokens the harness
 * handles itself (`pause`, `clear`, …) pass through as plain text; the token
 * list is per harness — Claude has only `clear`, Grok has four, Codex none —
 * so it comes from `HarnessCapabilities.goal.lifecycleArgs`.
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
  if (!args) return { type: 'compose' }
  if (isGoalLifecycleArg(args, lifecycleArgs)) return { type: 'passthrough' }
  return { type: 'set', objective: args }
}

/**
 * The objective a sent `/goal …` user message carries, or `null` when the line
 * is not a goal (plain prompt, bare `/goal`, or a lifecycle token such as
 * `/goal clear`). Harness-agnostic on purpose: a message bubble does not know
 * which harness it was sent to.
 */
export function goalMessageObjective(text: string): string | null {
  const action = goalComposerAction(text, ALL_GOAL_LIFECYCLE_ARGS)
  return action?.type === 'set' ? action.objective : null
}

/** True when the whole argument (not a prefix of it) is a lifecycle token. */
export function isGoalLifecycleArg(args: string, lifecycleArgs: readonly string[]): boolean {
  const normalized = args.trim().toLowerCase()
  return normalized.length > 0 && lifecycleArgs.includes(normalized)
}
