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
    onExitCompose: vi.fn(),
    onDismiss: vi.fn(),
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
      composing={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

/** The lucide icon inside the chip — the element that carries the breathing class. */
function chipIcon() {
  return document.querySelector('.lucide-goal')
}

describe('GoalIndicator', () => {
  it('breathes while the goal is being pursued and rests otherwise', () => {
    renderIndicator()
    expect(chipIcon()).toHaveClass('animate-pulse')
  })

  it('stops breathing once the goal is paused', () => {
    renderIndicator({ goal: goal('paused') })
    expect(chipIcon()).not.toHaveClass('animate-pulse')
  })

  it('turns into a green check reading Goal Achieved once the goal is complete', () => {
    renderIndicator({ goal: goal('complete') })

    const chip = screen.getByRole('button', { name: 'Goal Achieved' })
    expect(chip).toHaveClass('text-success')
    expect(chip.querySelector('.lucide-circle-check-big')).not.toBeNull()
    expect(chipIcon()).toBeNull()
  })

  /**
   * The harness clears its own goal on success, so the chip is a notice with
   * nothing left to act on — it dismisses instead of opening the popover.
   */
  it('dismisses an achieved goal from the chip instead of opening the popover', () => {
    const { onDismiss, onClear } = renderIndicator({ goal: goal('complete') })

    fireEvent.click(screen.getByRole('button', { name: 'Goal Achieved' }))

    expect(onDismiss).toHaveBeenCalled()
    expect(onClear).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear goal' })).toBeNull()
  })

  // Both icons are always rendered; CSS decides which one shows, so these
  // assert the swap pair exists rather than simulating :hover.
  it('swaps the achieved chip icon for a close mark on hover', () => {
    renderIndicator({ goal: goal('complete') })
    const chip = screen.getByRole('button', { name: 'Goal Achieved' })

    expect(chip.querySelector('.lucide-circle-check-big')).toHaveClass('group-hover/goal-done:hidden')
    expect(chip.querySelector('.lucide-x')).toHaveClass('group-hover/goal-done:block')
  })

  it('swaps the goal-mode chip icon for a close mark on hover', () => {
    renderIndicator({ goal: null, composing: true })
    const chip = screen.getByRole('button', { name: 'Goal' })

    expect(chip.querySelector('.lucide-goal')).toHaveClass('group-hover/goal-mode:hidden')
    expect(chip.querySelector('.lucide-x')).toHaveClass('group-hover/goal-mode:block')
  })

  it('offers no close mark while the goal is still being pursued', () => {
    renderIndicator()
    expect(screen.getByRole('button', { name: 'Goal' }).querySelector('.lucide-x')).toBeNull()
  })

  it('exits goal mode from the chip before any goal exists', () => {
    const { onExitCompose } = renderIndicator({ goal: null, composing: true })

    fireEvent.click(screen.getByTitle('Exit goal mode'))
    expect(onExitCompose).toHaveBeenCalled()
  })

  it('shows the goal-mode chip over a live goal while it is being edited', () => {
    renderIndicator({ composing: true })

    expect(screen.getByTitle('Exit goal mode')).toBeInTheDocument()
    // Goal mode replaces the popover trigger, so no popover is reachable.
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('hands Edit back to the composer instead of opening an editor of its own', () => {
    const { onEdit } = renderIndicator()

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalled()
  })

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

  it('shows the latest reason when the harness reports one', () => {
    renderIndicator({ goal: goal('paused', { lastReason: 'two suites still red' }) })

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

    expect(screen.getByText('Latest check: two suites still red')).toBeInTheDocument()
  })

  it('shows no progress line for a harness that reports none', () => {
    renderIndicator()

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))

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
