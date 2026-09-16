import type { CodexGoalStatus, SessionGoal } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'

export type GoalTransitions = {
  save: (objective: string) => Promise<void>
  clear: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
}

export type GoalTransitionDeps = {
  capability: GoalCapability
  /** What the session currently holds; `rpc` transitions rewrite it in place. */
  goal: SessionGoal | null
  /** A turn is running. Grok reads Stop as a pause, so this changes what pause does. */
  streaming: boolean
  /** Post a `/goal …` line as an ordinary turn. */
  send: (line: string) => Promise<void> | void
  interrupt: () => Promise<void> | void
  setGoal: (objective: string, status?: CodexGoalStatus) => Promise<void>
  clearGoal: () => Promise<void>
}

/**
 * Goal transitions routed by transport rather than by harness — the same split
 * the desktop composer makes, so both surfaces agree on what a transition is.
 *
 * A `slash` harness owns its goal and only needs the `/goal …` line posted as a
 * turn. Codex's goal lives in the app server, so each transition is an explicit
 * call whose result comes back as a `session_goal` event.
 *
 * Pause and resume are only ever reached when `capability.canPause` — the menu
 * leaves those rows out otherwise — so neither re-checks it here.
 */
export function sessionGoalTransitions(deps: GoalTransitionDeps): GoalTransitions {
  if (deps.capability.transport === 'slash') {
    return {
      save: async (objective) => { await deps.send(`/goal ${objective}`) },
      clear: async () => { await deps.send('/goal clear') },
      // Grok treats a cancel on an active goal as a user pause, so Stop is
      // enough while a turn is live — posting `/goal pause` after that is a
      // second prompt that only says the goal is already paused.
      pause: async () => {
        if (deps.streaming) { await deps.interrupt(); return }
        await deps.send('/goal pause')
      },
      resume: async () => { await deps.send('/goal resume') },
    }
  }
  return {
    save: async (objective) => { await deps.setGoal(objective) },
    clear: async () => { await deps.clearGoal() },
    // Status is the only thing changing, so the objective is resent as-is;
    // with no goal there is nothing to pause, and the menu offers neither.
    pause: async () => { if (deps.goal) await deps.setGoal(deps.goal.objective, 'paused') },
    resume: async () => { if (deps.goal) await deps.setGoal(deps.goal.objective, 'active') },
  }
}
