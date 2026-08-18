/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import type { ChatMessage, TaskNotificationMeta } from '@superone/shared/agent-types'
import { describe, expect, it } from 'vitest'
import {
  groupConsecutiveTaskNotifications,
  TaskNotificationGroup,
  TaskNotificationRow,
} from './TaskNotificationRow'

function notificationMessage(id: string, meta: TaskNotificationMeta): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    providerId: 'system',
    metadata: { taskNotification: meta },
  }
}

function assistantMessage(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: 'ordinary reply' }],
    createdAt: '2026-08-18T00:00:00.000Z',
    providerId: 'claude',
  }
}

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
    expect(screen.queryByText('watcher exited before the run finished')).not.toBeInTheDocument()
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

  it('does not repeat a summary that is the same as the task title', () => {
    render(
      <TaskNotificationRow
        meta={{
          status: 'completed',
          description: 'Inspect what the domain currently serves',
          summary: 'Inspect what the domain currently serves',
        }}
      />,
    )

    expect(screen.getByText('Background task finished')).toBeInTheDocument()
    expect(screen.getAllByText('Inspect what the domain currently serves')).toHaveLength(1)
  })

  it('hides a status-word summary the label already covers', () => {
    render(
      <TaskNotificationRow
        meta={{ status: 'completed', description: 'watch domain', summary: 'completed' }}
      />,
    )

    expect(screen.getByText('watch domain')).toBeInTheDocument()
    expect(screen.queryByText(/^completed$/i)).not.toBeInTheDocument()
  })

  it('groups only consecutive notifications so regular chat keeps its position', () => {
    const entries = groupConsecutiveTaskNotifications([
      notificationMessage('one', { status: 'stopped' }),
      notificationMessage('two', { status: 'failed' }),
      assistantMessage('reply'),
      notificationMessage('three', { status: 'completed' }),
    ])

    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ type: 'task-notification-group' })
    if (entries[0].type === 'task-notification-group') {
      expect(entries[0].items.map((item) => item.id)).toEqual(['one', 'two'])
    }
    expect(entries[1]).toMatchObject({ type: 'message', message: { id: 'reply' } })
    expect(entries[2]).toMatchObject({ type: 'task-notification-group' })
  })

  it('shows only the count until the notification group is expanded', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <TaskNotificationGroup
        items={[
          { id: 'one', meta: { status: 'stopped', description: 'watch dev server' } },
          { id: 'two', meta: { status: 'failed', description: 'run perf check' } },
          { id: 'three', meta: { status: 'completed', description: 'collect trace' } },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: '3 notifications' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('watch dev server')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('watch dev server')).toBeInTheDocument()
    expect(screen.getByText('run perf check')).toBeInTheDocument()
    expect(screen.getByText('collect trace')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByText('watch dev server')).not.toBeInTheDocument()
  })
})
