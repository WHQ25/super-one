import { describe, expect, it } from 'vitest'
import type { AgentEvent, SessionGoal } from '@superone/shared/agent-types'
import { ClaudeGoalTracker } from './claude-goal-tracker'

const cleared: AgentEvent = { type: 'session_goal', goal: null }
const stdout = (content: string): AgentEvent => ({ type: 'slash_command_output', messageId: 'm1', content })
const complete: AgentEvent = { type: 'message_complete', messageId: 'm1' }
const interrupted: AgentEvent = { type: 'message_interrupted', messageId: 'm1' }
const goalEvent = (goal: SessionGoal): AgentEvent => ({ type: 'session_goal', goal })

/** Set a goal and get past the CLI's confirmation, the way a real turn does. */
function withGoal(objective = 'all tests pass'): ClaudeGoalTracker {
  const tracker = new ClaudeGoalTracker()
  tracker.noteSend(`/goal ${objective}`)
  tracker.reconcile(stdout(`Goal set: ${objective}`))
  return tracker
}

const active = (objective = 'all tests pass'): SessionGoal =>
  ({ objective, status: 'active' })
const achieved = (objective = 'all tests pass'): SessionGoal =>
  ({ objective, status: 'complete' })

describe('ClaudeGoalTracker — set', () => {
  it('announces the goal as soon as /goal <condition> is sent', () => {
    const tracker = new ClaudeGoalTracker()
    expect(tracker.noteSend('/goal all tests pass')).toEqual([goalEvent(active())])
  })

  it('keeps the snapshot once the CLI confirms, passing the stdout through', () => {
    const tracker = new ClaudeGoalTracker()
    tracker.noteSend('/goal all tests pass')
    const out = stdout('Goal set: all tests pass')
    expect(tracker.reconcile(out)).toEqual([out])
  })

  it('takes the snapshot back when the CLI rejected the condition', () => {
    const tracker = new ClaudeGoalTracker()
    tracker.noteSend('/goal ' + 'x'.repeat(10))
    const out = stdout('Goal condition is limited to 2000 characters.')
    expect(tracker.reconcile(out)).toEqual([out, cleared])
    // Nothing is held, so the turn ending must not invent an achievement.
    expect(tracker.reconcile(complete)).toEqual([complete])
  })

  it('announces nothing for a bare /goal or a plain prompt', () => {
    // A bare `/goal` is the composer's own goal-mode trigger and never reaches
    // the harness as a set; a plain prompt is not a goal line at all.
    const tracker = new ClaudeGoalTracker()
    expect(tracker.noteSend('/goal')).toEqual([])
    expect(tracker.noteSend('make the suite green')).toEqual([])
    const out = stdout('all good')
    expect(tracker.reconcile(out)).toEqual([out])
  })
})

describe('ClaudeGoalTracker — achieved', () => {
  /**
   * The Stop hook is the only thing keeping the turn alive, so the turn ending
   * on its own means the condition passed.
   */
  it('completes the goal when the turn ends on its own', () => {
    const tracker = withGoal()
    expect(tracker.reconcile(complete)).toEqual([complete, goalEvent(achieved())])
  })

  it('does not complete on an interrupt — the goal survives for the next turn', () => {
    const tracker = withGoal()
    expect(tracker.reconcile(interrupted)).toEqual([interrupted])
    // Still live: the next natural end is what completes it.
    expect(tracker.reconcile(complete)).toEqual([complete, goalEvent(achieved())])
  })

  it('does not complete on a turn error', () => {
    const tracker = withGoal()
    const errored: AgentEvent = { type: 'message_error', messageId: 'm1', error: 'boom' }
    expect(tracker.reconcile(errored)).toEqual([errored])
  })

  it('completes only once, so later turns leave the achieved goal alone', () => {
    const tracker = withGoal()
    tracker.reconcile(complete)
    expect(tracker.reconcile(complete)).toEqual([complete])
  })

  it('never completes a goal that was never set', () => {
    const tracker = new ClaudeGoalTracker()
    expect(tracker.reconcile(complete)).toEqual([complete])
  })
})

describe('ClaudeGoalTracker — cleared', () => {
  it('drops an active goal the moment /goal clear is sent', () => {
    // The CLI answers a clear in prose only, so waiting for a wire event would
    // leave the chip on screen forever.
    const tracker = withGoal()
    expect(tracker.noteSend('/goal clear')).toEqual([cleared])
    // Clearing is a lifecycle command, not an outcome: the turn it rides on
    // ending must not re-read as achieved.
    expect(tracker.reconcile(complete)).toEqual([complete])
  })

  it('clears an achieved goal too', () => {
    const tracker = withGoal()
    tracker.reconcile(complete)
    expect(tracker.noteSend('/goal clear')).toEqual([cleared])
  })

  it('clears a goal it never saw, so a restored session is not stranded', () => {
    const tracker = new ClaudeGoalTracker()
    expect(tracker.noteSend('/goal clear')).toEqual([cleared])
  })

  it('does not clear on a prompt that merely mentions clearing', () => {
    const tracker = withGoal()
    expect(tracker.noteSend('/goal clear the backlog')).toEqual([
      goalEvent(active('clear the backlog')),
    ])
  })
})

describe('ClaudeGoalTracker — passthrough', () => {
  it('lets Claude report its own goal, outranking anything inferred here', () => {
    const tracker = withGoal()
    const reported = goalEvent({ objective: 'all tests pass', status: 'active', lastReason: 'two suites still red' })
    expect(tracker.reconcile(reported)).toEqual([reported])
    // The tracker adopted it, so a natural end completes that snapshot.
    expect(tracker.reconcile(complete)).toEqual([
      complete,
      goalEvent({ objective: 'all tests pass', status: 'complete', lastReason: 'two suites still red' }),
    ])
  })

  it('leaves unrelated events untouched', () => {
    const tracker = new ClaudeGoalTracker()
    const event: AgentEvent = { type: 'status_change', status: 'idle' }
    expect(tracker.reconcile(event)).toEqual([event])
  })
})
