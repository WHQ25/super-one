/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import { ProjectSidebarRow } from './ProjectSidebarRow'

const folder: RecentFolder = {
  id: 'loading',
  name: 'super-one',
  path: 'remote:node:/proj',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
}

const callbacks = {
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onHideSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onToggleExpand: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
  onLoadMoreSessions: vi.fn(async () => []),
}

describe('project folder loading icon', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
  })

  it('keeps a smaller spinner visible instead of the hover chevron', async () => {
    render(
      <ProjectSidebarRow
        {...callbacks}
        folder={folder}
        sessions={[]}
        sessionsLoading
        hasMoreSessions={false}
        isExpanded
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })

    const spinner = screen.getByLabelText('Loading...')
    const spinnerClass = spinner.getAttribute('class') ?? ''
    expect(spinnerClass).toContain('size-3.5')
    expect(spinnerClass).not.toContain('size-4.5')
    expect(spinnerClass).not.toContain('group-hover:hidden')
    const row = spinner.closest('.h-9')
    expect(row).not.toBeNull()
    expect(row?.querySelector('.lucide-chevron-right')?.getAttribute('class')).toContain('!hidden')
    expect(screen.queryByText('No sessions')).not.toBeInTheDocument()
  })
})
