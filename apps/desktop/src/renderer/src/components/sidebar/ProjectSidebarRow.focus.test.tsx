/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import { useSidebarFocusStore } from './sidebar-focus'

const folder: RecentFolder = {
  id: 'local',
  name: 'super-one',
  path: '/src/super-one',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
}

const session: SessionHistoryEntry = {
  sessionId: 'parent',
  title: 'Opening workflow',
  lastActiveAt: '0',
  messageCount: 1,
  childCount: 1,
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

describe('project focus', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
    useSidebarFocusStore.setState({ target: null })
    callbacks.onToggleExpand.mockClear()
  })

  it('enters focus on double click and keeps a single click as expand', () => {
    const { container } = render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[session]}
        isExpanded={false}
        focusEnvironmentId="env-1"
      />,
    )
    fireEvent.click(screen.getByText('super-one'))
    expect(callbacks.onToggleExpand).toHaveBeenCalledWith(folder.path)
    expect(useSidebarFocusStore.getState().target).toBeNull()
    fireEvent.doubleClick(screen.getByText('super-one'))
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project',
      folderPath: folder.path,
      environmentId: 'env-1',
    })
    expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull()
    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    expect(screen.getByText('Edit Project')).toBeInTheDocument()
    expect(screen.queryByText('Focus')).toBeNull()
  })

  it('does not focus a missing or offline project, or a double click on its actions', () => {
    const { rerender } = render(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...folder, missing: true }}
        sessions={[session]}
        isExpanded={false}
        focusEnvironmentId="env-1"
      />,
    )
    fireEvent.doubleClick(screen.getByText('super-one'))
    expect(useSidebarFocusStore.getState().target).toBeNull()

    rerender(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[session]}
        isExpanded={false}
        offline
        focusEnvironmentId="env-1"
      />,
    )
    fireEvent.doubleClick(screen.getByText('super-one'))
    expect(useSidebarFocusStore.getState().target).toBeNull()

    rerender(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[session]}
        isExpanded={false}
        focusEnvironmentId="env-1"
      />,
    )
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Search sessions…' }))
    expect(useSidebarFocusStore.getState().target).toBeNull()
  })

  it('keeps a child list capped while the project itself is capped', () => {
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[session]}
        isExpanded
        childSessions={{ parent: [{ ...session, sessionId: 'child', title: 'Draft', parentSessionId: 'parent', childCount: undefined }] }}
        initialExpandedChildIds={['parent']}
      />,
    )
    const childList = document.querySelector('[data-child-session-list]')
    expect(childList).toHaveClass('max-h-36')
    expect(childList).not.toHaveClass('h-full')
    expect(document.querySelector('[data-active-session-list]')).toHaveClass('max-h-64')
  })
})
