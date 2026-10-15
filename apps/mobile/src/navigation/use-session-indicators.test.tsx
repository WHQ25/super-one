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
    _worktreeRemoved: false, rateLimitInfo: null, messages: [],
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

test('reads when an idle session\'s prompt cache expires and clears it on leave', async () => {
  await renderWithTheme(<Probe />)
  const finished = { id: 'a1', role: 'assistant' as const, status: 'complete' as const, content: [], createdAt: '2026-10-16T09:59:00.000Z', providerId: 'claude-base', metadata: {
    completedAt: '2026-10-16T10:00:00.000Z',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheTtl: '5m' as const },
  } }
  await act(async () => indicators.sync({ ...source, session: { ...source.session, messages: [finished] } }))
  expect(indicators.cacheExpiry).toEqual({ expiresAt: Date.parse('2026-10-16T10:05:00.000Z'), contextTokens: 10_000 })

  await act(async () => indicators.reset())
  expect(indicators.cacheExpiry).toBeNull()
})
