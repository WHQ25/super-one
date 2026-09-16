import type { AgentEvent, SessionGoal } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { goalComposerAction } from '@superone/shared/session-goal'

const CLAUDE_GOAL_LIFECYCLE = HARNESS_CAPABILITIES.claude.goal!.lifecycleArgs
/** The CLI's `<local-command-stdout>` for a successful `/goal <condition>`. */
const GOAL_SET_CONFIRMATION = /^Goal set:/i

/**
 * Host-side view of Claude's session goal.
 *
 * Claude's goal is unlike Grok's or Codex's: it lives *inside a single turn*.
 * The condition is registered as a Stop hook, so the turn is not allowed to end
 * until the hook passes — which makes the three transitions readable from
 * ordinary turn events, with no goal-specific wire message needed:
 *
 * - **Achieved** — the turn ends on its own (`message_complete`). Nothing else
 *   could have let it stop, so a natural end *is* the condition being met.
 *   Claude clears its own goal at that point; the host keeps the `complete`
 *   snapshot so the composer can report it.
 * - **Not achieved** — the user interrupts (`message_interrupted`) or the turn
 *   errors. The hook never got to pass, so the goal survives and is still live
 *   for the next turn.
 * - **Cleared** — `/goal clear`, which is a lifecycle command rather than an
 *   outcome, so it must never read as achieved.
 *
 * Set and clear are both synthesised here: the CLI answers each with prose only
 * (`Goal set: …` / `Goal cleared: …`), so a host that waited for a wire event
 * would show nothing on set and strand the chip on clear.
 */
export class ClaudeGoalTracker {
  private goal: SessionGoal | null = null
  /** A `/goal <condition>` went out this turn and the CLI has not confirmed it yet. */
  private awaitingConfirmation = false

  /** Note what the next turn sends; returns the events to emit right away. */
  noteSend(content: string): AgentEvent[] {
    const action = goalComposerAction(content, CLAUDE_GOAL_LIFECYCLE)
    this.awaitingConfirmation = false
    if (action?.type === 'set') {
      this.awaitingConfirmation = true
      this.goal = { objective: action.objective, status: 'active' }
      return [{ type: 'session_goal', goal: this.goal }]
    }
    // Emitted unconditionally — a clear with nothing held is a no-op downstream,
    // and a session restored from disk can hold a goal this tracker never saw.
    if (action?.type === 'passthrough') {
      this.goal = null
      return [{ type: 'session_goal', goal: null }]
    }
    return []
  }

  /** Route an event through what the tracker knows; may add or rewrite `session_goal`. */
  reconcile(event: AgentEvent): AgentEvent[] {
    if (event.type === 'slash_command_output' && this.awaitingConfirmation) {
      this.awaitingConfirmation = false
      if (GOAL_SET_CONFIRMATION.test(event.content.trim())) return [event]
      // Rejected (length cap, empty condition): take the optimistic chip back.
      this.goal = null
      return [event, { type: 'session_goal', goal: null }]
    }
    // A turn that ends on its own is the Stop hook having passed.
    if (event.type === 'message_complete' && this.goal?.status === 'active') {
      this.goal = { ...this.goal, status: 'complete' }
      return [event, { type: 'session_goal', goal: this.goal }]
    }
    if (event.type !== 'session_goal') return [event]
    // Claude reporting its own goal outranks anything inferred here.
    this.goal = event.goal
    return [event]
  }
}
