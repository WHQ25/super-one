/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionGoal, SessionGoalStatus } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'
import { GoalIndicator } from './GoalIndicator'

const PAUSABLE: GoalCapability = {
  lifecycleArgs: ['pause', 'resume', 'clear'],
  canPause: true,
  transport: 'slash',
  semantics: 'objective',
}

const CONDITION_ONLY: GoalCapability = {
  lifecycleArgs: ['clear'],
  canPause: false,
  transport: 'slash',
  semantics: 'condition',
}

function goal(status: SessionGoalStatus, extra: Partial<SessionGoal> = {}): SessionGoal {
  return { objective: 'Ship the login flow', status, ...extra }
}

function renderIndicator(
  props: Partial<Parameters<typeof GoalIndicator>[0]> = {},
) {
  const handlers = {
    onEdit: vi.fn(),
    onClear: vi.fn().mockResolvedValue(undefined),
    onPause: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <GoalIndicator
      goal={goal('active')}
      capability={PAUSABLE}
      harnessName="Grok"
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('GoalIndicator', () => {
  it('resumes a paused goal from the popover', async () => {
    const { onResume } = renderIndicator({ goal: goal('paused') })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => expect(onResume).toHaveBeenCalled())
  })

  it('offers resume for a blocked goal, since the user is how it gets unstuck', async () => {
    const { onResume } = renderIndicator({ goal: goal('blocked') })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => expect(onResume).toHaveBeenCalled())
  })

  it('pauses an active goal and can clear it', async () => {
    const { onPause, onClear } = renderIndicator()

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(onPause).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('flips to paused after a successful pause even before the harness event arrives', async () => {
    renderIndicator()

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('omits pause and resume entirely for a harness without that lifecycle', () => {
    renderIndicator({ goal: goal('active'), capability: CONDITION_ONLY, harnessName: 'Claude' })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear goal' })).toBeInTheDocument()
  })

  it('titles the popover after the harness that owns the goal', () => {
    renderIndicator({ harnessName: 'Codex' })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

    expect(screen.getByText('Codex Goal')).toBeInTheDocument()
  })

  it('shows the evaluator count and its latest reason when the harness reports them', () => {
    renderIndicator({
      capability: CONDITION_ONLY,
      harnessName: 'Claude',
      goal: goal('active', { iterations: 3, lastReason: 'two suites still red' }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

    expect(screen.getByText('Checked 3 times so far')).toBeInTheDocument()
    expect(screen.getByText('Latest check: two suites still red')).toBeInTheDocument()
  })

  it('shows no progress line for a harness that reports neither', () => {
    renderIndicator()

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

    expect(screen.queryByText(/Checked/)).toBeNull()
    expect(screen.queryByText(/Latest check/)).toBeNull()
  })

  it('surfaces a failed transition instead of closing silently', async () => {
    const onPause = vi.fn().mockRejectedValue(new Error('agent is offline'))
    renderIndicator({ onPause })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(screen.getByText('agent is offline')).toBeInTheDocument())
  })
})
