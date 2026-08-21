/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AcpGoal } from '@superone/shared/agent-types'
import { GrokGoalIndicator } from './GrokGoalIndicator'

function goal(status: AcpGoal['status']): AcpGoal {
  return {
    goalId: 'g1',
    objective: 'Ship the login flow',
    status,
    tokensUsed: 0,
    elapsedMs: 0,
  }
}

describe('GrokGoalIndicator', () => {
  it('resumes a paused goal from the popover', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined)

    render(
      <GrokGoalIndicator
        goal={goal('paused')}
        onEdit={vi.fn()}
        onPause={vi.fn()}
        onResume={onResume}
        onClear={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => {
      expect(onResume).toHaveBeenCalled()
    })
  })

  it('pauses an active goal and can clear it', async () => {
    const onPause = vi.fn().mockResolvedValue(undefined)
    const onClear = vi.fn().mockResolvedValue(undefined)

    render(
      <GrokGoalIndicator
        goal={goal('active')}
        onEdit={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onClear={onClear}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => {
      expect(onPause).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }))
    await waitFor(() => {
      expect(onClear).toHaveBeenCalled()
    })
  })
})
