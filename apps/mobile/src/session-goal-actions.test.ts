import { describe, expect, it, vi } from 'vitest'
import type { SessionGoal } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES, resolveGoalCapability } from '@superone/shared/harness/harness-capabilities'
import { sessionGoalTransitions, type GoalTransitionDeps } from './session-goal-actions'

const GROK = resolveGoalCapability('acp', 'grok-build')!
const CLAUDE = HARNESS_CAPABILITIES.claude.goal!
const CODEX = HARNESS_CAPABILITIES.codex.goal!

const goal: SessionGoal = { objective: 'Ship the login flow', status: 'active' }

function deps(overrides: Partial<GoalTransitionDeps> = {}) {
  const spies = {
    send: vi.fn(async (_line: string) => {}),
    interrupt: vi.fn(async () => {}),
    setGoal: vi.fn(async (_objective: string, _status?: SessionGoal['status']) => {}),
    clearGoal: vi.fn(async () => {}),
  }
  const actions = sessionGoalTransitions({
    capability: GROK, goal, streaming: false, ...spies, ...overrides,
  })
  return { ...spies, actions }
}

describe('sessionGoalTransitions — slash transport', () => {
  it('posts every transition as an ordinary turn', async () => {
    const { actions, send, setGoal, clearGoal } = deps()

    await actions.save('Ship the login flow')
    await actions.clear()
    await actions.resume()

    expect(send.mock.calls.map(([line]) => line)).toEqual([
      '/goal Ship the login flow', '/goal clear', '/goal resume',
    ])
    // The harness owns the goal; nothing here talks to a host RPC.
    expect(setGoal).not.toHaveBeenCalled()
    expect(clearGoal).not.toHaveBeenCalled()
  })

  it('pauses with the line while the session is idle', async () => {
    const { actions, send, interrupt } = deps({ streaming: false })

    await actions.pause()

    expect(send).toHaveBeenCalledWith('/goal pause')
    expect(interrupt).not.toHaveBeenCalled()
  })

  /**
   * Grok reads a cancel on an active goal as a user pause, so Stop already is
   * the pause — posting the line on top of it is a second prompt saying the
   * goal it just paused is paused.
   */
  it('pauses by interrupting while a turn is live', async () => {
    const { actions, send, interrupt } = deps({ streaming: true })

    await actions.pause()

    expect(interrupt).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('routes Claude the same way, since its goal is a slash command too', async () => {
    const { actions, send } = deps({ capability: CLAUDE })

    await actions.save('all tests pass')
    await actions.clear()

    expect(send.mock.calls.map(([line]) => line)).toEqual(['/goal all tests pass', '/goal clear'])
  })
})

describe('sessionGoalTransitions — rpc transport', () => {
  it('sets and clears through the host instead of the transcript', async () => {
    const { actions, send, setGoal, clearGoal } = deps({ capability: CODEX })

    await actions.save('Ship the login flow')
    await actions.clear()

    expect(setGoal).toHaveBeenCalledWith('Ship the login flow')
    expect(clearGoal).toHaveBeenCalled()
    // A `/goal …` line would reach Codex as a plain prompt, so none is sent.
    expect(send).not.toHaveBeenCalled()
  })

  it('pauses and resumes by resending the objective under a new status', async () => {
    const { actions, setGoal } = deps({ capability: CODEX })

    await actions.pause()
    await actions.resume()

    expect(setGoal.mock.calls).toEqual([
      ['Ship the login flow', 'paused'],
      ['Ship the login flow', 'active'],
    ])
  })

  it('does nothing with no goal to restatus', async () => {
    const { actions, setGoal } = deps({ capability: CODEX, goal: null })

    await actions.pause()
    await actions.resume()

    expect(setGoal).not.toHaveBeenCalled()
  })
})
