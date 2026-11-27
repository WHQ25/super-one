import { describe, expect, it } from 'vitest'
import type { AgentEvent, SessionGoal } from '@superone/shared/agent-types'
import { AntigravityGoalTracker } from './antigravity-goal-tracker'

const cleared: AgentEvent = { type: 'session_goal', goal: null }
const complete: AgentEvent = { type: 'message_complete', messageId: 'm1' }
const interrupted: AgentEvent = { type: 'message_interrupted', messageId: 'm1' }
const errored: AgentEvent = { type: 'message_error', messageId: 'm1', error: 'boom' }
const textDelta = (text: string): AgentEvent => ({
  type: 'content_delta',
  messageId: 'm1',
  delta: { type: 'text', text },
})
const goalEvent = (goal: SessionGoal): AgentEvent => ({ type: 'session_goal', goal })

const active = (objective = 'ship the feature'): SessionGoal =>
  ({ objective, status: 'active' })
const achieved = (objective = 'ship the feature'): SessionGoal =>
  ({ objective, status: 'complete' })

describe('AntigravityGoalTracker', () => {
  it('emits an active goal when /goal <objective> is sent and completes on message_complete', () => {
    const tracker = new AntigravityGoalTracker()
    expect(tracker.noteSend('/goal ship the feature')).toEqual([goalEvent(active())])
    const delta = textDelta('Done.')
    expect(tracker.reconcile(delta)).toEqual([delta])
    expect(tracker.reconcile(complete)).toEqual([complete, goalEvent(achieved())])
  })

  it('clears the goal when <!-- GOAL_CANCELLED --> is streamed across chunks', () => {
    const tracker = new AntigravityGoalTracker()
    tracker.noteSend('/goal ship the feature')
    tracker.reconcile(textDelta('Stopping as requested. <!-- GOAL_'))
    tracker.reconcile(textDelta('CANCELLED -->'))
    expect(tracker.reconcile(complete)).toEqual([complete, cleared])
  })

  it('clears the goal on interrupt or error', () => {
    const tracker1 = new AntigravityGoalTracker()
    tracker1.noteSend('/goal ship the feature')
    expect(tracker1.reconcile(interrupted)).toEqual([interrupted, cleared])

    const tracker2 = new AntigravityGoalTracker()
    tracker2.noteSend('/goal ship the feature')
    expect(tracker2.reconcile(errored)).toEqual([errored, cleared])
  })

  it('ignores bare /goal and plain prompts', () => {
    const tracker = new AntigravityGoalTracker()
    expect(tracker.noteSend('/goal')).toEqual([])
    expect(tracker.noteSend('hello')).toEqual([])
    expect(tracker.reconcile(complete)).toEqual([complete])
  })
})
