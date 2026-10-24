/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import { setExternalLinkHandler } from '@/lib/external-link'
import { projectHoverFolders } from '@/lib/multi-host/project-hover'
import { ProjectHoverCard } from './multi-host/ProjectHoverCard'
import { SessionHoverCardTrigger } from './multi-host/SessionHoverCard'
import { ProjectSidebarRow } from './ProjectSidebarRow'

const local: RecentFolder = {
  id: 'local',
  name: 'super-one',
  path: '/src/super-one',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
  extraDirs: ['/src/ui'],
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

describe('project row menu', () => {
  beforeEach(() => {
    window.app.listAutomations = vi.fn(async () => [])
    window.app.showInFolder = vi.fn(async () => undefined)
    callbacks.onEditProject.mockClear()
  })

  it('opens the local folder from the context menu and keeps edit', () => {
    const { container } = render(
      <ProjectSidebarRow
        {...callbacks}
        folder={local}
        sessions={[{ sessionId: 'a', title: 'A', lastActiveAt: '0', messageCount: 1 }]}
        sessionsLoaded
        hasMoreSessions={false}
        isExpanded={false}
        repoIdentity="git:https://github.com/acme/super-one.git"
      />,
    )
    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    fireEvent.click(screen.getByText('Edit Project'))
    expect(callbacks.onEditProject).toHaveBeenCalledWith(local)
    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    fireEvent.click(screen.getByText('Open Folder'))
    expect(window.app.showInFolder).toHaveBeenCalledWith('/src/super-one', '')
  })

  it('omits Open Folder for a remote checkout', () => {
    const { container } = render(
      <ProjectSidebarRow
        {...callbacks}
        folder={{ ...local, path: 'remote:cli-1:/srv/app' }}
        sessions={[]}
        hasMoreSessions={false}
        isExpanded={false}
        repoIdentity={null}
      />,
    )
    fireEvent.contextMenu(container.querySelector('[data-slot="hover-card-trigger"]')!)
    expect(screen.queryByText('Open Folder')).toBeNull()
    expect(screen.getByText('Edit Project')).toBeInTheDocument()
  })
})

describe('project hover card', () => {
  it('names the github repo as owner/repo and asks the link chooser before opening', () => {
    window.app.openExternalLink = vi.fn(async () => undefined)
    const choose = vi.fn()
    const stop = setExternalLinkHandler(choose)
    const onEdit = vi.fn()
    render(
      <ProjectHoverCard
        open
        name="super-one"
        repoIdentity="git:git@github.com:acme/super-one.git"
        folders={projectHoverFolders('/src/super-one', ['/src/ui'])}
        sessionCount={1}
        sessionPaths={[]}
        onEdit={onEdit}
      >
        <SessionHoverCardTrigger>
          <div>super-one</div>
        </SessionHoverCardTrigger>
      </ProjectHoverCard>,
    )
    const card = document.querySelector('[data-project-hover]')
    expect(card?.textContent).toContain('acme/super-one')
    expect(card?.textContent).not.toContain('github.com/acme')
    expect(card?.textContent).toContain('1 Session')
    expect(card?.querySelector('[title="/src/ui"]')).not.toBeNull()
    expect(card?.querySelector('svg.lucide-github')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'acme/super-one' }))
    expect(choose).toHaveBeenCalledWith('https://github.com/acme/super-one')
    expect(window.app.openExternalLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-slot="hover-card-content"]')?.getAttribute('data-side')).toBe('right')
    stop()
  })

  it('shows the home-relative path and opens that folder from the row icon', () => {
    window.app.showInFolder = vi.fn(async () => undefined)
    render(
      <ProjectHoverCard
        open
        name="super-one"
        repoIdentity={null}
        folders={projectHoverFolders('/Users/a/src/super-one', ['/Users/a/src/super-one/packages/ui']).map((folder) => ({
          ...folder,
          openable: true,
        }))}
        sessionCount={0}
        sessionPaths={[]}
      >
        <SessionHoverCardTrigger>
          <div>super-one</div>
        </SessionHoverCardTrigger>
      </ProjectHoverCard>,
    )
    expect(screen.getByText('~/src/super-one')).toBeInTheDocument()
    expect(screen.getByText('~/src/super-one/packages/ui')).toBeInTheDocument()
    const openers = screen.getAllByRole('button', { name: 'Open Folder' })
    expect(openers).toHaveLength(2)
    expect(openers[0]).toHaveClass('opacity-0')
    fireEvent.click(openers[1]!)
    expect(window.app.showInFolder).toHaveBeenCalledWith('/Users/a/src/super-one/packages/ui', '')
  })

  it('omits the folder opener when the checkout is not on this machine', () => {
    render(
      <ProjectHoverCard
        open
        name="app"
        repoIdentity={null}
        folders={projectHoverFolders('/srv/app')}
        sessionCount={0}
        sessionPaths={[]}
      >
        <SessionHoverCardTrigger>
          <div>app</div>
        </SessionHoverCardTrigger>
      </ProjectHoverCard>,
    )
    expect(screen.getByText('/srv/app')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Folder' })).toBeNull()
  })
})
