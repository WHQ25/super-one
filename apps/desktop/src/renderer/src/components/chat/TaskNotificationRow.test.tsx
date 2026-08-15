/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskNotificationRow } from './TaskNotificationRow'

describe('background task notification row', () => {
  it('names the task and its outcome so the wake that produced the next turn is visible', () => {
    render(
      <TaskNotificationRow
        meta={{
          status: 'stopped',
          description: 'gh run watch --exit-status',
          summary: 'watcher exited before the run finished',
          outputFile: '/tmp/superone/watcher-4821.log',
          usage: { totalTokens: 1240, toolUses: 3, durationMs: 134_000 },
        }}
      />,
    )

    expect(screen.getByText('Background task stopped')).toBeInTheDocument()
    expect(screen.getByText('gh run watch --exit-status')).toBeInTheDocument()
    expect(screen.getByText('watcher exited before the run finished')).toBeInTheDocument()
    // Duration / tokens / log file are compact suffixes, not full paths.
    expect(screen.getByText('· 2m 14s')).toBeInTheDocument()
    expect(screen.getByText('· 1.2k')).toBeInTheDocument()
    expect(screen.getByText('· watcher-4821.log')).toBeInTheDocument()
  })

  it('tones the row by outcome so a failure is not mistaken for a clean finish', () => {
    const { container, rerender } = render(<TaskNotificationRow meta={{ status: 'completed' }} />)
    expect(container.querySelector('[data-task-notification="completed"]')).not.toBeNull()
    expect(container.querySelector('.text-success')).not.toBeNull()

    rerender(<TaskNotificationRow meta={{ status: 'failed' }} />)
    expect(container.querySelector('[data-task-notification="failed"]')).not.toBeNull()
    expect(container.querySelector('.text-error')).not.toBeNull()
  })

  it('renders a bare status when the harness reports no description, summary or usage', () => {
    render(<TaskNotificationRow meta={{ status: 'completed' }} />)
    expect(screen.getByText('Background task finished')).toBeInTheDocument()
  })
})
