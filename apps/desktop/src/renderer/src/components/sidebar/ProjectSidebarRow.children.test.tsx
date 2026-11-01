/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { ProjectSidebarRow } from './ProjectSidebarRow'

const folder: RecentFolder = {
  id: 'nested',
  name: 'super-one',
  path: '/storybook/nested',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
}

const callbacks = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onSettleSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onToggleExpand: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
}

function session(sessionId: string, title: string, extra?: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '0', messageCount: 1, ...extra }
}

describe('project child lists', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
  })

  it('starts the named child lists open and leaves the others collapsed', async () => {
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        isExpanded
        sessions={[
          session('open-parent', 'Open parent', { childCount: 1 }),
          session('closed-parent', 'Closed parent', { childCount: 1 }),
        ]}
        childSessions={{
          'open-parent': [session('open-child', 'Open child', { parentSessionId: 'open-parent' })],
          'closed-parent': [session('closed-child', 'Closed child', { parentSessionId: 'closed-parent' })],
        }}
        initialExpandedChildIds={['open-parent']}
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByText('Open child').closest('[data-child-session-list]')).not.toBeNull()
    expect(screen.queryByText('Closed child')).toBeNull()
  })
})
