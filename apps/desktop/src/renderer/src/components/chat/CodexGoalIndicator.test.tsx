/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexGoal, CodexGoalStatus } from '@superone/shared/agent-types'
import { CodexGoalIndicator } from './CodexGoalIndicator'

const codexSetGoal = vi.fn()
const codexClearGoal = vi.fn()

function goal(status: CodexGoalStatus): CodexGoal {
  return {
    threadId: 'thread-1',
    objective: 'Ship the goal UX',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, {
    app: {
      ...window.app,
      codexSetGoal,
      codexClearGoal,
    },
  })
})

describe('CodexGoalIndicator', () => {
  it('resumes a paused goal from the popover', async () => {
    codexSetGoal.mockResolvedValue(goal('active'))
    const onGoalChange = vi.fn()

    render(
      <CodexGoalIndicator
        sessionId="session-1"
        threadId="thread-1"
        goal={goal('paused')}
        onGoalChange={onGoalChange}
        onEdit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))

    await waitFor(() => {
      expect(codexSetGoal).toHaveBeenCalledWith('session-1', 'thread-1', 'Ship the goal UX', 'active')
    })
    expect(onGoalChange).toHaveBeenCalledWith(goal('active'))
  })

  it('pauses an active goal and can clear it', async () => {
    codexSetGoal.mockResolvedValue(goal('paused'))
    codexClearGoal.mockResolvedValue(true)
    const onGoalChange = vi.fn()

    const { rerender } = render(
      <CodexGoalIndicator
        sessionId="session-1"
        threadId="thread-1"
        goal={goal('active')}
        onGoalChange={onGoalChange}
        onEdit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => {
      expect(codexSetGoal).toHaveBeenCalledWith('session-1', 'thread-1', 'Ship the goal UX', 'paused')
    })

    rerender(
      <CodexGoalIndicator
        sessionId="session-1"
        threadId="thread-1"
        goal={goal('paused')}
        onGoalChange={onGoalChange}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }))

    await waitFor(() => {
      expect(codexClearGoal).toHaveBeenCalledWith('session-1', 'thread-1')
    })
    expect(onGoalChange).toHaveBeenCalledWith(null)
  })
})
