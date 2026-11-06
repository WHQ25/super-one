/** @vitest-environment jsdom */
import type { ComponentProps } from 'react'
import { act, fireEvent, screen, waitFor, within, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { applySidebarFocus, focusEnvironment, focusProject, focusSession } from './sidebar-focus'
import { SidebarFocusView } from './SidebarFocusView'
import { focusEnvironments, focusFork, focusLocal, focusRemote, focusSessions, focusSessionEntry, focusSettled } from './project-focus.fixtures'

const environment: EnvironmentBucket = {
  environmentId: 'env-1',
  connectionId: 'local',
  label: 'Build machine',
  kind: 'local',
  connection: 'connected',
  projectsStatus: 'ready',
  projectsError: null,
  checkouts: [],
}

afterEach(() => {
  applySidebarFocus(null)
})

describe('SidebarFocusView', () => {
  it('places the focused object’s pinned sessions and drafts under the focus bar', () => {
    focusEnvironment(environment.environmentId)
    render(
      <SidebarFocusView
        environments={[environment]}
        sort="recent"
        expandedProjectKeys={new Set()}
        folders={[]}
        localHostLabel="This Mac"
        folderSessions={{}}
        loadingFolders={{}}
        openingSession={null}
        connectionBusyId={null}
        refreshingConnectionId={null}
        onLoadFolderSessions={vi.fn()}
        onLoadMoreSessions={vi.fn()}
        onToggleProject={vi.fn()}
        onSwitchSession={vi.fn()}
        onPinSession={vi.fn()}
        onSettleSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onEditProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onNewSession={vi.fn()}
        onRefreshEnvironment={vi.fn()}
        onToggleConnection={vi.fn()}
        onAddProject={vi.fn()}
        belowBar={<div>Pinned and drafts</div>}
      />,
    )

    const focus = document.querySelector('[data-sidebar-focus]')
    const bar = focus?.querySelector('[data-sidebar-focus-bar]')
    const context = focus?.querySelector('[data-sidebar-focus-context]')
    const projects = focus?.querySelector('[data-environment-id]')
    expect(bar).toBeTruthy()
    expect(context).toBeTruthy()
    expect(projects).toBeTruthy()
    if (!bar || !context || !projects) return
    expect(context).toHaveTextContent('Pinned and drafts')
    expect(bar.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(context.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('replaces the focused environment icon with loading bars while its CLI installs', () => {
    focusEnvironment(environment.environmentId)
    render(
      <SidebarFocusView
        environments={[environment]}
        sort="recent"
        expandedProjectKeys={new Set()}
        folders={[]}
        localHostLabel="This Mac"
        folderSessions={{}}
        loadingFolders={{}}
        openingSession={null}
        connectionBusyId={null}
        refreshingConnectionId={null}
        upgradingLabels={{ local: 'Upgrading Build machine to SuperOne CLI 2…' }}
        onLoadFolderSessions={vi.fn()}
        onLoadMoreSessions={vi.fn()}
        onToggleProject={vi.fn()}
        onSwitchSession={vi.fn()}
        onPinSession={vi.fn()}
        onSettleSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onEditProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onNewSession={vi.fn()}
        onRefreshEnvironment={vi.fn()}
        onToggleConnection={vi.fn()}
        onAddProject={vi.fn()}
      />,
    )

    const bar = document.querySelector('[data-sidebar-focus-bar]')
    expect(bar?.querySelector('[data-slot="environment-upgrading"]')?.getAttribute('aria-label')).toMatch(/SuperOne CLI 2/)
    expect(bar?.querySelector('.lucide-monitor')).toBeNull()
  })
})

function renderProject(extra: Partial<ComponentProps<typeof SidebarFocusView>> = {}) {
  focusProject(focusLocal.pathKey, focusLocal.environmentId)
  const props: ComponentProps<typeof SidebarFocusView> = {
    environments: focusEnvironments, folders: [], localHostLabel: 'This computer',
    sort: 'recent', expandedProjectKeys: new Set(), folderSessions: focusSessions,
    settledSessions: focusSettled, settledCounts: { [focusLocal.pathKey]: 21, [focusRemote.pathKey]: 32 },
    loadingFolders: {}, openingSession: null, connectionBusyId: null, refreshingConnectionId: null,
    onLoadFolderSessions: vi.fn(), onLoadMoreSessions: vi.fn(), onLoadMoreSettled: vi.fn(),
    onToggleProject: vi.fn(), onSwitchSession: vi.fn(), onPinSession: vi.fn(), onSettleSession: vi.fn(),
    onRenameSession: vi.fn(), onDeleteSession: vi.fn(), onEditProject: vi.fn(), onRemoveProject: vi.fn(),
    onNewSession: vi.fn(), onRefreshEnvironment: vi.fn(), onToggleConnection: vi.fn(), onAddProject: vi.fn(),
    ...extra,
  }
  return { ...render(<SidebarFocusView {...props} />), props }
}

describe('project focus across origins', () => {
  beforeEach(() => {
    localStorage.clear()
    window.app.listAutomations = vi.fn(async () => [])
  })

  it('shows local and remote sessions for the same normalized origin and keeps forks out', async () => {
    const { props } = renderProject()
    await waitFor(() => expect(screen.getByText('Remote active session')).toBeInTheDocument())
    expect(screen.getByText('Local active session')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated fork session')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Remote active session'))
    expect(props.onSwitchSession).toHaveBeenCalledWith(focusRemote.pathKey, 'remote-active', { revealProject: false })
  })

  it('loads every matching connected checkout and skips offline environments', () => {
    const { props, rerender } = renderProject({ folderSessions: {} })
    expect(props.onLoadFolderSessions).toHaveBeenCalledWith(focusLocal.pathKey)
    expect(props.onLoadFolderSessions).toHaveBeenCalledWith(focusRemote.pathKey)
    expect(props.onLoadFolderSessions).not.toHaveBeenCalledWith(focusFork.pathKey)
    const offline = focusEnvironments.map((bucket) => bucket.kind === 'local' ? bucket : { ...bucket, connection: 'offline' as const })
    vi.mocked(props.onLoadFolderSessions).mockClear()
    rerender(<SidebarFocusView {...props} environments={offline} />)
    expect(props.onLoadFolderSessions).not.toHaveBeenCalledWith(focusRemote.pathKey)
  })

  it('puts all settled sessions below active environments with exactly two disclosure levels', async () => {
    const { container, props } = renderProject({ settledHasMore: { [focusRemote.pathKey]: true } })
    const settled = screen.getByRole('button', { name: /Settled/ })
    expect(settled).toHaveTextContent('53')
    expect(screen.queryByText('Remote settled session')).not.toBeInTheDocument()
    fireEvent.click(settled)
    const panel = document.getElementById(settled.getAttribute('aria-controls')!)!
    const remote = within(panel).getByRole('button', { name: /Build server/ })
    expect(remote).toHaveAttribute('aria-expanded', 'false')
    expect(remote).toHaveTextContent('32')
    fireEvent.click(remote)
    await waitFor(() => expect(within(panel).getByText('Remote settled session')).toBeInTheDocument())
    expect(within(panel).queryByText('Local settled session')).not.toBeInTheDocument()
    expect(within(panel).getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'))).toHaveLength(2)
    fireEvent.click(within(panel).getByText('Remote settled session'))
    expect(props.onSwitchSession).toHaveBeenCalledWith(focusRemote.pathKey, 'node-1-settled', { revealProject: false })
    const list = panel.querySelector('[data-settled-list] [data-slot="scroll-area-viewport"]')!
    fireEvent.scroll(list)
    expect(props.onLoadMoreSettled).toHaveBeenCalledWith(focusRemote.pathKey)
    const active = container.querySelector('[data-project-focus-active]')!
    expect(active.compareDocumentPosition(settled) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reveals a folded environment when the focus bar searches its sessions', async () => {
    const { container } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    const local = within(active).getByRole('button', { name: /This computer/ })
    fireEvent.click(local)
    expect(local).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: /Search sessions/ }))
    await waitFor(() => expect(local).toHaveAttribute('aria-expanded', 'true'))
  })

  it('can fold an active environment independently of its settled sessions', async () => {
    const { container } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    const local = within(active).getByRole('button', { name: /This computer/ })
    expect(local).toHaveAttribute('data-sidebar-section', 'environment')
    fireEvent.click(local)
    expect(local).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Local active session')).not.toBeVisible()
    expect(screen.getByText('Remote active session')).toBeVisible()
  })
})

describe('project focus checkout boundaries', () => {
  beforeEach(() => {
    localStorage.clear()
    window.app.listAutomations = vi.fn(async () => [])
  })

  it('also aggregates when focus starts on the remote checkout', () => {
    renderProject()
    act(() => focusProject(focusRemote.pathKey, focusRemote.environmentId))
    expect(screen.getByText('Local active session')).toBeInTheDocument()
    expect(screen.getByText('Remote active session')).toBeInTheDocument()
  })

  it('does not merge same-named projects without an origin', () => {
    renderProject({ environments: focusEnvironments.map((bucket) => ({
      ...bucket, checkouts: bucket.checkouts.map((checkout) => ({ ...checkout, repoIdentity: null })),
    })) })
    expect(screen.getByText('Local active session')).toBeInTheDocument()
    expect(screen.queryByText('Remote active session')).not.toBeInTheDocument()
  })

  it('loads a matching environment when its catalog arrives after focusing', () => {
    const { props, rerender } = renderProject({ environments: [focusEnvironments[0]!], folderSessions: {} })
    expect(props.onLoadFolderSessions).not.toHaveBeenCalledWith(focusRemote.pathKey)
    rerender(<SidebarFocusView {...props} environments={focusEnvironments} />)
    expect(props.onLoadFolderSessions).toHaveBeenCalledWith(focusRemote.pathKey)
  })

  it('combines several checkouts on one environment under one settled heading', () => {
    const copy = { ...focusLocal, pathKey: '/src/super-one-copy', hostPath: '/src/super-one-copy', projectId: 'copy' }
    const copiedSession = { ...focusSettled[0]!, sessionId: 'copy-settled', folderPath: copy.pathKey, title: 'Copy settled' }
    const { props } = renderProject({
      environments: [{ ...focusEnvironments[0]!, checkouts: [focusLocal, copy] }],
      folderSessions: { ...focusSessions, [copy.pathKey]: [focusSessionEntry('copy-active', 'Copy active')] },
      settledSessions: [...focusSettled, copiedSession],
    })
    expect(screen.getByText('Copy active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const section = document.querySelector('[data-project-focus-settled]')! as HTMLElement
    expect(within(section).getAllByRole('button', { name: /This computer/ })).toHaveLength(1)
    fireEvent.click(within(section).getByRole('button', { name: /This computer/ }))
    expect(within(section).getByText('Local settled session')).toBeInTheDocument()
    fireEvent.click(within(section).getByText('Copy settled'))
    expect(props.onSwitchSession).toHaveBeenCalledWith(copy.pathKey, 'copy-settled', { revealProject: false })
  })
})

describe('parent session focus', () => {
  it('shows a session icon and opens the focused parent without leaving focus', () => {
    const { container, props } = renderProject({ folderSessions: {
      [focusLocal.pathKey]: [focusSessionEntry('parent', 'Parent workflow')],
    } })
    act(() => focusSession(focusLocal.pathKey, 'parent', focusLocal.environmentId))
    const title = container.querySelector('[data-sidebar-focus-title]')!
    expect(title.querySelector('.lucide-message-square')).toBeTruthy()
    fireEvent.click(title)
    expect(props.onSwitchSession).toHaveBeenCalledWith(focusLocal.pathKey, 'parent', { revealProject: false })
  })
})
