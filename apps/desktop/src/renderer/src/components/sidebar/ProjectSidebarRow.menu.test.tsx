/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import { setExternalLinkHandler } from '@/lib/external-link'
import { projectHoverFolders } from '@/lib/multi-host/project-hover'
import { ProjectHoverBody, ProjectHoverCard, resetProjectHoverSessionTotals } from './multi-host/ProjectHoverCard'
import { useTerminalStore } from '@/stores/terminal'
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
  onSettleSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onToggleExpand: vi.fn(),
  onEditProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onNewSession: vi.fn(),
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

  it('counts every session, including settled sessions and children', async () => {
    resetProjectHoverSessionTotals()
    const previous = window.environment.listSessions
    const listSessions = vi.fn(async () => [
      { sessionId: 'active', title: 'Active', lastActiveAt: '2026-01-01T00:00:00.000Z', messageCount: 1 },
      { sessionId: 'settled', title: 'Settled', lastActiveAt: '2026-01-01T00:00:00.000Z', messageCount: 1, isSettled: true },
      { sessionId: 'hidden', title: 'Hidden', lastActiveAt: '2026-01-01T00:00:00.000Z', messageCount: 0, isHidden: true },
      { sessionId: 'child', title: 'Child', lastActiveAt: '2026-01-01T00:00:00.000Z', messageCount: 1, parentSessionId: 'active' },
    ])
    window.environment.listSessions = listSessions
    try {
      render(
        <ProjectHoverBody
          name="app"
          repoIdentity={null}
          folders={[]}
          sessionCount={1}
          sessionPaths={['/src/app']}
        />,
      )
      expect(await screen.findByText('3 Sessions')).toBeInTheDocument()
      expect(screen.queryByText('1 Session')).toBeNull()
      expect(listSessions).toHaveBeenCalledWith('local', '/src/app', expect.objectContaining({
        includeSettled: true,
        limit: 100,
        offset: 0,
      }))
    } finally {
      window.environment.listSessions = previous
      resetProjectHoverSessionTotals()
    }
  })

  it('omits the session line while the project is offline', () => {
    resetProjectHoverSessionTotals()
    const previous = window.environment.listSessions
    const listSessions = vi.fn(async () => [])
    window.environment.listSessions = listSessions
    try {
      render(
        <ProjectHoverBody
          name="app"
          repoIdentity={null}
          folders={[]}
          sessionPaths={['/src/app']}
          offline
        />,
      )
      expect(screen.queryByText(/Session/)).toBeNull()
      expect(listSessions).not.toHaveBeenCalled()
    } finally {
      window.environment.listSessions = previous
    }
  })

  it('shows running sessions by harness on one line', () => {
    render(
      <ProjectHoverBody
        name="app"
        repoIdentity={null}
        folders={[]}
        sessionCount={4}
        sessionPaths={[]}
        runningCounts={[
          { provider: 'claude', count: 2 },
          { provider: 'codex', count: 1 },
        ]}
      />,
    )
    const row = document.querySelector('[data-slot="project-running"]')
    expect([...row!.querySelectorAll('.tabular-nums')].map((node) => node.textContent)).toEqual(['2', '1'])
    expect(row?.querySelector('.claude-session-wrap')).not.toBeNull()
    expect(row?.querySelector('.codex-session-cursor-run')).not.toBeNull()
    expect(row?.querySelectorAll(':scope > span')).toHaveLength(2)
    const title = screen.getByText('app')
    expect(title.compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('4 Sessions').compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('[data-project-hover]')?.lastElementChild).toBe(row)
  })

  it('counts shared terminal tabs on the project and leaves out other projects', async () => {
    useTerminalStore.setState({
      byProject: {
        '/src/app': { tabs: [{ terminalId: 'a' }, { terminalId: 'b' }] as never, activeId: 'a' },
        '/src/other': { tabs: [{ terminalId: 'c' }] as never, activeId: 'c' },
      },
    })
    try {
      render(
        <ProjectHoverBody
          name="app"
          repoIdentity={null}
          folders={[]}
          sessionCount={1}
          sessionPaths={['/src/app']}
        />,
      )
      const row = document.querySelector('[data-project-terminals]')
      expect(row?.textContent).toBe('2')
      expect(row?.parentElement?.lastElementChild).toBe(row)
      await userEvent.hover(row!.querySelector('[data-tab-kind="terminal"]')!)
      expect(await screen.findByRole('tooltip')).toHaveTextContent(i18n.t('sidebar.projectHover.terminalsHint'))
    } finally {
      useTerminalStore.setState({ byProject: {} })
    }
  })

  it('counts listed project terminals that are not on the strip yet', async () => {
    useTerminalStore.setState({ byProject: {} })
    const previous = window.terminal
    window.terminal = {
      list: vi.fn(async () => [
        { terminalId: 'shell', cwd: '/src/app', projectPath: '/src/app', status: 'running' },
        { terminalId: 'agent', cwd: '/src/app', projectPath: '/src/app', status: 'running', agentSessionId: 's1' },
        { terminalId: 'docked', cwd: '/src/app', projectPath: '/src/app', status: 'running', openedInActivity: true },
        { terminalId: 'done', cwd: '/src/app', projectPath: '/src/app', status: 'exited' },
      ]),
    } as never
    try {
      render(
        <ProjectHoverBody
          name="app"
          repoIdentity={null}
          folders={[]}
          sessionCount={1}
          sessionPaths={['/src/app', '/src/other']}
        />,
      )
      expect(await screen.findByText('1')).toBeTruthy()
      expect(document.querySelector('[data-project-terminals]')?.textContent).toBe('1')
    } finally {
      window.terminal = previous
      useTerminalStore.setState({ byProject: {} })
    }
  })
})
