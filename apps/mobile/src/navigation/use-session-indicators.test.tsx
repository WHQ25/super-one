import { expect, test } from '@jest/globals'
import { act, screen } from '@testing-library/react-native'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { renderWithTheme } from '../test-render'
import { GoalChip } from '../ui/goal-chip'
import { useSessionIndicators, type SessionIndicatorSource } from './use-session-indicators'

const source: SessionIndicatorSource = {
  sandboxInfo: { enabled: true, autoAllowBash: false },
  worktree: { isWorktree: true, worktreePath: '/repo/worktree', gitBranch: 'fix/mobile' },
  contextTokens: 10_000, contextWindow: 200_000, totalCostUsd: 1,
  session: {
    sessionGoal: { objective: 'Finish the mobile fixes', status: 'active' },
    sessionAgents: [{ id: 'project-agent', name: 'Project agent' }],
    _worktreeRemoved: false, rateLimitInfo: null,
  },
}
const noop = () => {}
let indicators: ReturnType<typeof useSessionIndicators>
function Probe() {
  indicators = useSessionIndicators()
  return <GoalChip goal={indicators.sessionGoal} capability={HARNESS_CAPABILITIES.claude.goal!}
    onEdit={noop} onClear={noop} onPause={noop} onResume={noop} onDismiss={noop} />
}

test.each(['active', 'paused', 'complete'] as const)('leaving a session clears its %s goal before opening a new session', async status => {
  await renderWithTheme(<Probe />)
  await act(async () => indicators.sync({ ...source, session: {
    ...source.session, sessionGoal: { ...source.session.sessionGoal!, status },
  } }))
  expect(screen.getByLabelText(status === 'complete' ? 'Goal Achieved' : `Goal: ${status === 'active' ? 'Active' : 'Paused'}`)).toBeTruthy()

  await act(async () => indicators.reset())
  expect(screen.queryByLabelText(/Goal/)).toBeNull()
  expect(indicators.sessionGoal).toBeNull()
})

test('clears session-defined agents and other readouts while the next session loads', async () => {
  await renderWithTheme(<Probe />)
  await act(async () => indicators.sync(source))
  expect(indicators.sessionAgents).toEqual(source.session.sessionAgents)

  await act(async () => indicators.reset())
  expect(indicators.sessionAgents).toBeNull()
  expect(indicators.sandboxInfo).toBeNull()
  expect(indicators.sessionWorktree).toEqual({ isWorktree: false, worktreePath: null, gitBranch: null, removed: false })
  expect(indicators.usage).toEqual({ contextTokens: 0, contextWindow: null, totalCostUsd: 0 })

  await act(async () => indicators.sync({ ...source, session: { ...source.session, sessionGoal: null, sessionAgents: null } }))
  expect(screen.queryByLabelText(/Goal/)).toBeNull()

  // Reset only clears the viewed readouts. Returning restores the original goal.
  await act(async () => indicators.sync(source))
  expect(screen.getByLabelText('Goal: Active')).toBeTruthy()
  expect(indicators.sessionAgents).toEqual(source.session.sessionAgents)
})
