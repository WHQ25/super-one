/** @vitest-environment jsdom */
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { settledPanelId } from '@/components/sidebar/sidebar-section-collapse'
import { appState, chatState, mockEnvironment, sessionFixtures, toastWarning, toastSuccess, toastLoading } from './AppSidebar.test-setup'
import { ACTIVE_SESSION_PAGE_SIZE } from '@/lib/session-list-ops'

describe('AppSidebar interactions', () => {
  it('keeps project action anchors measurable while the row is not hovered', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    const { container } = render(<AppSidebar />)

    const actions = container.querySelector('[data-slot="project-row-actions"]')
    expect(actions).not.toBeNull()
    expect(actions).toHaveClass('invisible', 'flex', 'opacity-0')
    expect(actions).not.toHaveClass('hidden')
    expect(actions?.querySelector('.lucide-search')).not.toBeNull()
  })

  it('expands a remote project folder without focusing a session', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'remote lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'project-1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(await screen.findByText('remote-app'))

    await waitFor(() => {
      expect(mockEnvironment.listSessions).toHaveBeenCalled()
    })
    expect(appState.selectProject).not.toHaveBeenCalled()
  })

  it('upgrades a node that trails this desktop without asking, exactly once', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-stale'
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      {
        connectionId: 'env-stale',
        kind: 'remote',
        state: 'connected',
        label: 'vps',
        cliVersion: '0.49.4-alpha',
        nodeUpgrade: {
          remoteVersion: '0.49.4-alpha',
          targetVersion: '0.50.3-alpha',
          canUpgradeOverSsh: true,
        },
      },
    ])

    let resolveUpgrade: (value: { version: string; warnings: string[] }) => void = () => {}
    mockEnvironment.upgradeNode.mockImplementation(
      () => new Promise((resolve) => { resolveUpgrade = resolve }),
    )

    const { AppSidebar } = await import('./AppSidebar')
    const { rerender } = render(<AppSidebar />)

    await waitFor(() => {
      expect(mockEnvironment.upgradeNode).toHaveBeenCalledWith('env-stale')
    })
    await waitFor(() => {
      const match = [...document.querySelectorAll('[data-slot="environment-section-header"]')]
        .find((row) => row.textContent?.includes('vps') && row.querySelector('[data-slot="environment-upgrading"]'))
      expect(match?.querySelector('[data-slot="environment-upgrading"]')?.getAttribute('aria-label')).toMatch(/0\.50\.3-alpha/)
      expect(match?.querySelector('.lucide-cloud')).toBeNull()
    })
    expect(toastLoading).not.toHaveBeenCalled()

    resolveUpgrade({ version: '0.50.3-alpha', warnings: [] })
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1)
    })
    // Informed, not asked: the outcome is a toast. The install itself stays on the row.
    expect(toastSuccess.mock.calls[0]![0]).toMatch(/0\.50\.3-alpha/)
    await waitFor(() => {
      expect(document.querySelector('[data-slot="environment-section-header"] [data-slot="environment-upgrading"]')).toBeNull()
    })

    // An upgrade bounces the node, so a re-render must not start a second one.
    rerender(<AppSidebar />)
    expect(mockEnvironment.upgradeNode).toHaveBeenCalledTimes(1)
  })

  it('asks the user to upgrade by hand when the node has no SSH endpoint', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-socket'
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      {
        connectionId: 'env-socket',
        kind: 'remote',
        state: 'connected',
        label: 'vps',
        cliVersion: '0.49.4-alpha',
        nodeUpgrade: {
          remoteVersion: '0.49.4-alpha',
          targetVersion: '0.50.3-alpha',
          canUpgradeOverSsh: false,
        },
      },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await waitFor(() => {
      expect(toastWarning).toHaveBeenCalledTimes(1)
    })
    expect(toastWarning.mock.calls[0]![0]).toMatch(/npm install -g @super-one\/cli/)
    expect(mockEnvironment.upgradeNode).not.toHaveBeenCalled()
  })

  it('leaves a node alone when it already matches this desktop', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-current'
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      {
        connectionId: 'env-current',
        kind: 'remote',
        state: 'connected',
        label: 'vps',
        cliVersion: '0.50.3-alpha',
      },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await waitFor(() => {
      expect(mockEnvironment.listProjects).toHaveBeenCalledWith('env-current')
    })
    expect(mockEnvironment.upgradeNode).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('does not select a missing remote project', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'remote lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      {
        projectId: 'stale-1',
        path: '/old/project',
        name: 'missing-app',
        lastActiveAt: 1,
        missing: true,
      },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(await screen.findByText('missing-app'))

    expect(appState.selectProject).not.toHaveBeenCalled()
  })

  it('manually refreshes the selected remote host project list', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'remote lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'project-1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)
    await screen.findByText('remote-app')
    mockEnvironment.listProjects.mockClear()

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort Projects' })).toBeInTheDocument()
    const actions = refreshButton.parentElement
    expect(actions?.children).toHaveLength(4)
    expect(actions?.children[0]?.querySelector('.lucide-plus')).not.toBeNull()
    expect(actions?.children[1]?.querySelector('.lucide-arrow-down-up')).not.toBeNull()
    expect(actions?.children[2]).toBe(refreshButton)
    expect(actions?.children[3]?.querySelector('.lucide-power')).not.toBeNull()

    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(mockEnvironment.listProjects).toHaveBeenCalledWith(
        'env-remote',
        { refresh: true },
      )
    })
  })

  it('disconnects the selected remote host from the power button', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', kind: 'remote', state: 'connected', desired: true, label: 'remote lab', endpointProfiles: [] },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'project-1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)
    expect(await screen.findAllByText('remote-app')).not.toHaveLength(0)

    const power = await screen.findByRole('button', { name: 'Disconnect', hidden: true })
    expect(power).toHaveClass('text-muted-foreground')
    expect(power).toHaveClass('hover:text-destructive')
    fireEvent.click(power)

    await waitFor(() => {
      expect(mockEnvironment.disconnect).toHaveBeenCalledWith('env-remote')
    })
    expect(mockEnvironment.connect).not.toHaveBeenCalled()
  })

  it('shows a turned-off host as offline and connects it from the power button', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', kind: 'remote', state: 'disconnected', desired: false, label: 'remote lab', endpointProfiles: [] },
    ])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    const offline = await screen.findByRole('button', { name: /Offline/ })
    if (offline.getAttribute('aria-expanded') !== 'true') fireEvent.click(offline)
    expect(await screen.findByText('remote lab')).toBeInTheDocument()
    expect(screen.queryByText('Host offline')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    expect(mockEnvironment.connect).not.toHaveBeenCalled()
    expect(mockEnvironment.listProjects).not.toHaveBeenCalledWith('env-remote')
    expect(mockEnvironment.listProjects).not.toHaveBeenCalledWith('env-remote', expect.anything())

    const power = screen.getByRole('button', { name: 'Connect', hidden: true })
    expect(power).toHaveClass('text-muted-foreground')
    expect(power).toHaveClass('hover:text-success')
    fireEvent.click(power)

    await waitFor(() => {
      expect(mockEnvironment.connect).toHaveBeenCalledWith('env-remote')
    })
  })

  it('lists every machine under its environment when another machine is connected', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.experimentalRemoteNodesEnabled = true
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'local', environmentId: 'local', kind: 'local', state: 'connected', label: 'This Mac' },
      {
        connectionId: 'env-remote',
        environmentId: 'env-remote',
        kind: 'remote',
        state: 'connected',
        label: 'remote lab',
        installationProfile: 'nohup',
      },
    ])
    mockEnvironment.listProjects.mockImplementation(async (connectionId?: string) => (
      connectionId === 'local'
        ? [{ projectId: 'local-app', path: '/work/app', name: 'app', lastActiveAt: 2, repoIdentity: 'git:https://github.com/acme/app.git' }]
        : [{ projectId: 'remote-app', path: '/srv/app', name: 'app', lastActiveAt: 1, repoIdentity: 'git:git@github.com:acme/app.git' }]
    ))

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    expect(await screen.findByText('This Mac')).toBeInTheDocument()
    expect(screen.getByText('remote lab')).toBeInTheDocument()
    expect(screen.queryByText('Projects')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Group By' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'By Project' })).toBeNull()
    fireEvent.click(screen.getAllByText('app')[0]!)
    await waitFor(() => {
      expect(mockEnvironment.listSessions).toHaveBeenCalledWith('local', '/work/app', expect.anything())
    })
  })

  it('hides the host power toggle while this computer is selected', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)
    await screen.findByText('project-a')
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('keeps an opened settled Codex session out of the active list', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [{
        sessionId: 'sid-voice',
        title: 'Opened voice',
        lastActiveAt: '2026-03-02T00:00:00.000Z',
        messageCount: 2,
        isSettled: true,
        provider: 'codex',
      }, {
        sessionId: 'sid-other',
        title: 'Other voice',
        lastActiveAt: '2026-03-01T00:00:00.000Z',
        messageCount: 2,
        isSettled: true,
        provider: 'codex',
      }],
    }
    const idle = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      status: 'idle',
      pendingPermissions: [],
      pendingQuestion: null,
      pendingPlanApproval: null,
      awaitingAssistantReply: false,
      sessionProvider: 'codex',
      _gitBranch: null,
      _historyHydrated: true,
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-voice',
        _sessions: {
          'sid-voice': { ...idle, _title: 'Opened voice' },
          'sid-other': { ...idle, _title: 'Other voice' },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }
    const { useCodexRealtimeViewStore } = await import('@/stores/codex-realtime-view')
    useCodexRealtimeViewStore.setState({ sessions: {} })
    for (const sessionId of ['sid-voice', 'sid-other']) {
      useCodexRealtimeViewStore.getState().setTimeline(sessionId, {
        segments: [{ id: 'seg-1', realtimeSessionId: 'rt-1', role: 'user', text: 'spoken' }],
        threadMessages: [],
        activeRealtimeSessionId: null,
        hasTimeline: true,
      })
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)
    fireEvent.click(screen.getByText('project-a'))
    await screen.findByRole('button', { name: /Settled/ })
    expect(screen.queryByText('Opened voice')).toBeNull()
    expect(screen.queryByText('Other voice')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const panel = document.getElementById(settledPanelId('/project-a'))
    const opened = await screen.findByText('Opened voice')
    const other = screen.getByText('Other voice')
    expect(panel).toContainElement(opened)
    expect(panel).toContainElement(other)
    expect(screen.getAllByText('Opened voice')).toHaveLength(1)
    expect(screen.getAllByText('Other voice')).toHaveLength(1)
    useCodexRealtimeViewStore.setState({ sessions: {} })
  })

  it('settles a session into the settled group', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Old Session')

    const title = screen.getByText('Old Session')
    expect(title.closest('[data-slot="hover-card-trigger"]')).not.toBeNull()
    const row = title.closest('.group\\/session') as HTMLElement
    const buttons = row.querySelectorAll('button')
    fireEvent.click(buttons[0] as HTMLButtonElement)

    await waitFor(() => {
      expect(mockEnvironment.setSessionUiFlags).toHaveBeenCalledWith('local', 'sid-1', { isSettled: true })
    })
    expect(mockEnvironment.setSessionRead).toHaveBeenCalledWith('local', 'sid-1', true)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Settled/ })).toBeInTheDocument()
      expect(screen.queryByText('Old Session')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const panel = document.getElementById(settledPanelId('/project-a'))
    const settledTitle = screen.getByText('Old Session')
    expect(panel).toContainElement(settledTitle)
    expect(settledTitle.closest('.group\\/session')).not.toBeNull()
    expect(settledTitle.closest('.group\\/pin')).toBeNull()
  })

  it('shows the normal session menu with unpin for a pinned session', async () => {
    chatState.activeProject = null
    mockEnvironment.listPinnedSessions.mockResolvedValue([{
      sessionId: 'sid-pinned',
      title: 'Pinned Session',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      messageCount: 2,
      provider: 'claude',
      isPinned: true,
      folderPath: '/project-a',
      folderName: 'project-a',
    }])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Pinned Session')
    const pinRow = screen.getByText('Pinned Session').closest('.group\\/pin')
    expect(pinRow?.textContent).not.toContain('project-a')
    expect(screen.getByText('Pinned Session').closest('[data-slot="hover-card-trigger"]')).not.toBeNull()
    fireEvent.click(pinRow?.querySelector('button') as HTMLButtonElement)

    await waitFor(() => {
      expect(mockEnvironment.setSessionUiFlags).toHaveBeenCalledWith('local', 'sid-pinned', { isPinned: false })
    })
    expect(screen.getByRole('button', { name: 'Rename Session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('folds pinned sessions behind a count', async () => {
    chatState.activeProject = null
    mockEnvironment.listPinnedSessions.mockResolvedValue([{
      sessionId: 'sid-pinned',
      title: 'Pinned Session',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      messageCount: 2,
      provider: 'claude',
      isPinned: true,
      folderPath: '/project-a',
      folderName: 'project-a',
    }])

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Pinned Session')
    const header = screen.getByRole('button', { name: 'Pinned' })
    fireEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header.querySelector('[data-slot="section-count"]')).toHaveTextContent('1')
    expect(document.getElementById('sidebar-section-pinned')).toHaveAttribute('inert')
    expect(screen.getByText('Pinned Session')).toBeInTheDocument()
  })

  it('asks the selected host for its own pinned sessions instead of the local ones', async () => {
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    appState.experimentalRemoteNodesEnabled = true
    chatState.activeProject = null
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'remote lab' },
    ])
    mockEnvironment.listPinnedSessions.mockImplementation(async (connectionId: string) =>
      connectionId === 'env-remote'
        ? [{
            sessionId: 'sid-remote-pin',
            title: 'Remote Pinned',
            lastActiveAt: '2026-03-02T00:00:00.000Z',
            messageCount: 1,
            provider: 'claude' as const,
            isPinned: true,
            folderPath: 'remote:env-remote:/work/remote-app',
            folderName: 'remote-app',
          }]
        : [],
    )

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('remote lab')
    expect(await screen.findByText('Remote Pinned')).toBeInTheDocument()
    // Pins stay global; the hover card says which environment each one lives on.
    expect(screen.getByText('Pinned').closest('[data-environment-id]')).toBeNull()
    expect(screen.getByText('Remote Pinned').closest('[data-environment-id]')).toBeNull()
    expect(screen.getByText('Remote Pinned').closest('[data-slot="hover-card-trigger"]')).not.toBeNull()
    expect(mockEnvironment.listPinnedSessions).toHaveBeenCalledWith('env-remote')
  })

  it('shows collapsed live session when awaitingAssistantReply is true', async () => {
    const project = chatState.projectSessions['/project-a'] as {
      _activeSessionId: string
      _sessions: Record<string, unknown>
      unseenCompletedSessions: Set<string>
    }
    const session = project._sessions['sid-1'] as { awaitingAssistantReply: boolean }
    session.awaitingAssistantReply = true

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Old Session')
  })

  /**
   * A voice session has no chat messages and often no DB row at all — the sidebar
   * synthesises its row out of renderer memory (see ProjectSidebarRow's realtime
   * exemption). Deleting only the database row therefore matched nothing and left the
   * row on screen, where every further delete was equally powerless.
   */
  it('drops a voice-only session from memory when deleted, not just from the database', async () => {
    sessionFixtures.byFolder = { '/project-a': [] }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-voice',
        _sessions: {
          'sid-voice': {
            messages: [],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'codex',
            _gitBranch: null,
            _historyHydrated: true,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }
    const { useCodexRealtimeViewStore } = await import('@/stores/codex-realtime-view')
    useCodexRealtimeViewStore.getState().setTimeline('sid-voice', {
      segments: [{ id: 'seg-1', realtimeSessionId: 'rt-1', role: 'user', text: 'spoken' }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)
    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('New session')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(confirm[confirm.length - 1] as HTMLButtonElement)

    await waitFor(() => {
      expect(mockEnvironment.removeSession).toHaveBeenCalledWith('local', 'sid-voice')
      expect(chatState.removeSessionFromMemory).toHaveBeenCalledWith('/project-a', 'sid-voice')
    })
  })

  it('does not show a phantom New session for an unhydrated live session without user text', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
            _historyHydrated: true,
          },
          'sid-old': {
            messages: [{ role: 'assistant', content: [] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
            _historyHydrated: false,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await waitFor(() => {
      expect(mockEnvironment.listSessions).toHaveBeenCalledWith(
        'local',
        '/project-a',
        { limit: ACTIVE_SESSION_PAGE_SIZE, offset: 0, rootsOnly: true },
      )
    })
    expect(screen.queryByText('New session')).toBeNull()
  })

  it('loads a child page when its parent is expanded', async () => {
    const parentId = 'parent-0'
    sessionFixtures.byFolder = {
      '/project-a': [
        {
          sessionId: parentId,
          title: 'Parent 0',
          lastActiveAt: '2026-04-07T00:00:01.000Z',
          messageCount: 1,
        },
        {
          sessionId: 'boundary-child',
          parentSessionId: parentId,
          title: 'Boundary child',
          lastActiveAt: '2026-04-07T00:00:00.000Z',
          messageCount: 1,
        },
      ],
    }

    const { AppSidebar } = await import('./AppSidebar')
    const { container } = render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    expect(await screen.findByText('Parent 0')).toBeInTheDocument()
    expect(screen.queryByText('Boundary child')).toBeNull()
    expect(screen.queryByText('Show More')).toBeNull()
    expect(mockEnvironment.listSessions).not.toHaveBeenCalledWith(
      'local',
      '/project-a',
      { limit: ACTIVE_SESSION_PAGE_SIZE, offset: 0, parentSessionId: parentId },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Expand sub-sessions' }))
    expect(await screen.findByText('Boundary child')).toBeInTheDocument()
    expect(container.querySelector('[data-child-session-list]')).not.toBeNull()
    expect(mockEnvironment.listSessions).toHaveBeenCalledWith(
      'local',
      '/project-a',
      { limit: ACTIVE_SESSION_PAGE_SIZE, offset: 0, parentSessionId: parentId },
    )
  })

  it('does not spin the title while a local session opens', async () => {
    let release: () => void = () => {}
    chatState.switchSession.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    sessionFixtures.byFolder = {
      '/project-a': [
        { sessionId: 'sid-a', title: 'Session A', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
        { sessionId: 'sid-b', title: 'Session B', lastActiveAt: '2026-03-02T00:01:00.000Z', messageCount: 3 },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-a',
        _sessions: {
          'sid-a': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    fireEvent.click(await screen.findByText('Session B'))
    await waitFor(() => {
      expect(chatState.switchSession).toHaveBeenCalledWith('sid-b')
    })
    expect(screen.queryByLabelText('Loading...')).toBeNull()
    await act(async () => { release() })
  })

  it('spins the title while a remote session hydrates', async () => {
    let release: () => void = () => {}
    chatState.switchSession.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    appState.currentFolder = null
    appState.recentFolders = []
    appState.selectedHostConnectionId = 'env-remote'
    chatState.projectSessions = {}
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'remote lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'project-1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])
    sessionFixtures.byFolder = {
      'project-1': [
        { sessionId: 'sid-remote', title: 'Remote session', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 1 },
      ],
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(await screen.findByText('remote-app'))
    fireEvent.click(await screen.findByText('Remote session'))
    expect(await screen.findByLabelText('Loading...')).toBeInTheDocument()
    await act(async () => { release() })
  })

  it('keeps session order after clicking another session in the same project', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [
        { sessionId: 'sid-a', title: 'Session A', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
        { sessionId: 'sid-b', title: 'Session B', lastActiveAt: '2026-03-02T00:01:00.000Z', messageCount: 3 },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-a',
        _sessions: {
          'sid-a': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
          'sid-b': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'b' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Session A')
    await screen.findByText('Session B')

    const firstA = screen.getByText('Session A')
    const firstB = screen.getByText('Session B')
    expect(firstA.compareDocumentPosition(firstB) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    fireEvent.click(firstB)
    await waitFor(() => {
      expect(chatState.switchSession).toHaveBeenCalledWith('sid-b')
    })

    const afterA = screen.getByText('Session A')
    const afterB = screen.getByText('Session B')
    expect(afterA.compareDocumentPosition(afterB) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('shows a running session together with every other non-settled session', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [
        ...Array.from({ length: 6 }, (_, index) => ({
          sessionId: `sid-recent-${index}`,
          title: `Recent session ${index}`,
          lastActiveAt: new Date(2026, 8, 4, 11, 30 - index).toISOString(),
          messageCount: 2,
        })),
        {
          sessionId: 'sid-running',
          title: 'Long running session',
          lastActiveAt: '2026-09-04T09:00:00.000Z',
          messageCount: 2,
        },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-recent-0',
        _sessions: {
          'sid-running': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'long task' }] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Long running session')

    expect(screen.getByText('Recent session 5')).toBeInTheDocument()
    expect(screen.queryByText('Show More')).toBeNull()
  })

  it('loads the next page of non-settled sessions when the list scrolls', async () => {
    chatState.activeProject = null
    sessionFixtures.byFolder = {
      '/project-a': Array.from({ length: 40 }, (_, index) => ({
        sessionId: `sid-page-${index}`,
        title: `Paged session ${index}`,
        lastActiveAt: new Date(2026, 8, 4, 12, 0, -index).toISOString(),
        messageCount: 2,
      })),
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: null,
        _sessions: {},
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    const { container } = render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Paged session 0')
    expect(screen.getByText(`Paged session ${ACTIVE_SESSION_PAGE_SIZE - 1}`)).toBeInTheDocument()
    expect(screen.queryByText('Paged session 39')).toBeNull()
    expect(screen.queryByText('Show More')).toBeNull()
    expect(mockEnvironment.listSessions).toHaveBeenCalledWith(
      'local',
      '/project-a',
      { limit: ACTIVE_SESSION_PAGE_SIZE, offset: 0, rootsOnly: true },
    )
    expect(mockEnvironment.listSessions).not.toHaveBeenCalledWith(
      'local',
      '/project-a',
      { limit: ACTIVE_SESSION_PAGE_SIZE, offset: ACTIVE_SESSION_PAGE_SIZE, rootsOnly: true },
    )

    fireEvent.scroll(container.querySelector('[data-active-session-list] [data-slot="scroll-area-viewport"]')!)
    expect(await screen.findByText('Paged session 39')).toBeInTheDocument()
    expect(screen.queryByText('Show More')).toBeNull()

    fireEvent.click(screen.getByText('project-a'))
    await waitFor(() => {
      expect(screen.queryByText('Paged session 0')).toBeNull()
    })
    fireEvent.click(screen.getByText('project-a'))
    expect(await screen.findByText('Paged session 39')).toBeInTheDocument()
    expect(screen.queryByText('Show More')).toBeNull()
  })

  it('shows every running session when their count exceeds the initial cutoff', async () => {
    const normalSessions = Array.from({ length: 6 }, (_, index) => ({
      sessionId: `sid-normal-${index}`,
      title: `Normal fill session ${index}`,
      lastActiveAt: new Date(2026, 8, 4, 11, 30 - index).toISOString(),
      messageCount: 2,
    }))
    const runningSessions = Array.from({ length: 7 }, (_, index) => ({
      sessionId: `sid-running-${index}`,
      title: `Running session ${index}`,
      lastActiveAt: new Date(2026, 8, 4, 9, 30 - index).toISOString(),
      messageCount: 2,
    }))
    sessionFixtures.byFolder = {
      '/project-a': [
        ...normalSessions,
        ...runningSessions,
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-running-0',
        _sessions: Object.fromEntries(runningSessions.map((session) => [
          session.sessionId,
          {
            messages: [{ role: 'user', content: [{ type: 'text', text: session.title }] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        ])),
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await Promise.all(runningSessions.map((session) => screen.findByText(session.title)))

    await Promise.all(normalSessions.map((session) => screen.findByText(session.title)))
    expect(screen.queryByText('Show More')).toBeNull()
  })

  it('shows an unseen session while collapsed and prioritizes it when expanded', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [
        ...Array.from({ length: 6 }, (_, index) => ({
          sessionId: `sid-normal-${index}`,
          title: `Normal session ${index}`,
          lastActiveAt: new Date(2026, 8, 4, 11, 30 - index).toISOString(),
          messageCount: 2,
        })),
        {
          sessionId: 'sid-unseen',
          title: 'Unseen completed session',
          lastActiveAt: '2026-09-04T09:00:00.000Z',
          messageCount: 2,
        },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-unseen',
        _sessions: {},
        unseenCompletedSessions: new Set(['sid-unseen']),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    const unseen = await screen.findByText('Unseen completed session')
    expect(screen.queryByText('Normal session 0')).toBeNull()

    fireEvent.click(screen.getByText('project-a'))
    const firstNormal = await screen.findByText('Normal session 0')

    expect(unseen.compareDocumentPosition(firstNormal) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByText('Normal session 5')).toBeInTheDocument()
  })

  it('keeps the foreground idle session visible without promoting it', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [
        ...Array.from({ length: 6 }, (_, index) => ({
          sessionId: `sid-newer-${index}`,
          title: `Newer session ${index}`,
          lastActiveAt: new Date(2026, 8, 4, 11, 30 - index).toISOString(),
          messageCount: 2,
        })),
        {
          sessionId: 'sid-foreground',
          title: 'Foreground idle session',
          lastActiveAt: '2026-09-04T09:00:00.000Z',
          messageCount: 2,
        },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-foreground',
        _sessions: {
          'sid-foreground': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'foreground' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    const foreground = await screen.findByText('Foreground idle session')
    expect(screen.queryByText('Newer session 0')).toBeNull()

    fireEvent.click(screen.getByText('project-a'))
    const firstNormal = await screen.findByText('Newer session 0')

    // Idle means it is not competing for attention: it keeps its own (oldest)
    // spot in the list rather than jumping above the more recent sessions,
    // but the display limit still may not drop the session being viewed.
    expect(firstNormal.compareDocumentPosition(foreground) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByText('Newer session 5')).toBeTruthy()
  })

  it('does not expand the project when switching to a session shown while collapsed', async () => {
    sessionFixtures.byFolder = {
      '/project-a': [
        ...Array.from({ length: 6 }, (_, index) => ({
          sessionId: `sid-normal-${index}`,
          title: `Normal session ${index}`,
          lastActiveAt: new Date(2026, 8, 4, 11, 30 - index).toISOString(),
          messageCount: 2,
        })),
        {
          sessionId: 'sid-unseen',
          title: 'Unseen completed session',
          lastActiveAt: '2026-09-04T09:00:00.000Z',
          messageCount: 2,
        },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-normal-0',
        _sessions: {},
        unseenCompletedSessions: new Set(['sid-unseen']),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    // Collapsed rows are already reachable, so clicking one is a plain switch —
    // it must not toggle the project open under the cursor.
    fireEvent.click(await screen.findByText('Unseen completed session'))
    await waitFor(() => expect(chatState.switchSession).toHaveBeenCalledWith('sid-unseen'))
    expect(screen.queryByText('Normal session 1')).toBeNull()
  })

  it('keeps showing a switched-away draft session while awaiting first reply', async () => {
    appState.currentFolder = '/project-b'
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:01:00.000Z' },
    ]
    sessionFixtures.byFolder = {
      '/project-a': [
        { sessionId: 'sid-1', title: 'Old Session', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
      ],
      '/project-b': [
        { sessionId: 'sid-b', title: 'Current Project Session', lastActiveAt: '2026-03-02T00:01:00.000Z', messageCount: 1 },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'old' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
          '__draft__': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'Pending first reply' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: true,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
      '/project-b': {
        _activeSessionId: 'sid-b',
        _sessions: {
          'sid-b': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'current project' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Pending first reply')
  })

  it('does not invent a row for an idle session the loaded list did not return', async () => {
    sessionFixtures.byFolder = {
      '/project-a': Array.from({ length: 10 }, (_, i) => ({
        sessionId: `sid-${i}`,
        title: `Session ${i}`,
        lastActiveAt: new Date(2026, 3, 7, 10 - i).toISOString(),
        messageCount: 2,
      })),
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-0',
        _sessions: {
          'sid-0': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'current' }] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
          },
          'sid-old-beyond-page': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'old browsed session' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _gitBranch: null,
            _historyHydrated: true,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Session 0')

    expect(screen.queryByText('old browsed session')).toBeNull()
  })

  it('does not submit session rename while IME composition is active', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Old Session')

    fireEvent.click(screen.getAllByText('Rename Session')[0] as HTMLButtonElement)

    const input = screen.getByDisplayValue('Old Session')
    fireEvent.change(input, { target: { value: '新标题' } })

    const composingEnter = createEvent.keyDown(input, { key: 'Enter' })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    fireEvent(input, composingEnter)

    expect(mockEnvironment.renameSession).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockEnvironment.renameSession).toHaveBeenCalledWith('local', 'sid-1', '新标题')
    })
  })

  it('keeps project order stable when the store re-sorts after recent activity', async () => {
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
    ]
    sessionFixtures.byFolder = { '/project-a': [], '/project-b': [], '/project-c': [] }
    chatState.projectSessions = {}

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    appState.recentFolders = [
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    fireEvent.click(screen.getByText('project-a'))

    await waitFor(() => {
      const a = screen.getByText('project-a')
      const b = screen.getByText('project-b')
      const c = screen.getByText('project-c')
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
      expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    })
  })

  it('puts a newly added project at the top of the frozen recent order', async () => {
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    sessionFixtures.byFolder = { '/project-a': [], '/project-b': [] }
    chatState.projectSessions = {}

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    appState.recentFolders = [
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    fireEvent.click(screen.getByText('project-a'))

    await screen.findByText('project-c')

    const c = screen.getByText('project-c')
    const a = screen.getByText('project-a')
    const b = screen.getByText('project-b')
    expect(c.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('loads sessions on startup for non-current folders persisted in expandedProjectKeys', async () => {
    const { useMultiHostSidebarStore } = await import('@/stores/multi-host-sidebar')
    useMultiHostSidebarStore.getState().setExpandedProjectKeys(['/super-one'])

    appState.currentFolder = '/project-a'
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'super-one', path: '/super-one', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    sessionFixtures.byFolder = {
      '/project-a': [],
      '/super-one': [
        {
          sessionId: 'sid-super-1',
          title: 'Persisted Expanded Session',
          lastActiveAt: '2026-03-02T01:00:00.000Z',
          messageCount: 3,
        },
      ],
    }
    chatState.projectSessions = {}

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    expect(await screen.findByText('Persisted Expanded Session')).toBeInTheDocument()
  })
})
