/** @vitest-environment jsdom */
import type { ComponentProps } from 'react'
import { act, fireEvent, screen, waitFor, within, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { applySidebarFocus, focusEnvironment, focusProject, focusSession, useSidebarFocusStore } from './sidebar-focus'
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

  it('starts sessions in each environment’s project without changing focus or folding the group', () => {
    const { container, props } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    for (const checkout of [focusLocal, focusRemote]) {
      const group = active.querySelector(`[data-focus-environment="${checkout.environmentId}"]`)! as HTMLElement
      const heading = group.querySelector('[data-sidebar-section="environment"]')!
      const create = within(group).getByRole('button', { name: 'New Session', hidden: true })
      expect(create.closest('[data-slot="section-actions"]')).toHaveClass('invisible', 'group-hover:visible', 'group-focus-within:visible')
      fireEvent.click(create)
      expect(props.onNewSession).toHaveBeenLastCalledWith(checkout.pathKey)
      expect(heading).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(heading)
      fireEvent.click(create)
      expect(props.onNewSession).toHaveBeenLastCalledWith(checkout.pathKey)
      expect(heading).toHaveAttribute('aria-expanded', 'false')
    }
    expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project', folderPath: focusLocal.pathKey, environmentId: focusLocal.environmentId,
    })
  })

  it('does not offer creation for unavailable environments or missing checkouts', () => {
    const { container } = renderProject({ environments: focusEnvironments.map((bucket) => ({
      ...bucket,
      ...(bucket.kind === 'local'
        ? { checkouts: bucket.checkouts.map((checkout) => ({ ...checkout, missing: true })) }
        : { connection: 'offline' as const }),
    })) })
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    expect(within(active).queryByRole('button', { name: 'New Session', hidden: true })).toBeNull()
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

  it('searches all environments from the project bar and only one from its host action', async () => {
    const listSessions = vi.fn(async () => [])
    Object.assign(window.environment, {
      listSessions,
      listProjects: vi.fn(async () => [{ projectId: focusRemote.projectId, path: focusRemote.hostPath }]),
    })
    const { container } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    const remote = active.querySelector('[data-focus-environment="server"]')! as HTMLElement
    const heading = remote.querySelector('[data-sidebar-section="environment"]')!
    fireEvent.click(heading)
    fireEvent.click(within(remote).getByRole('button', { name: /Search sessions/, hidden: true }))
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith('node-1', focusRemote.projectId, expect.objectContaining({ includeSettled: true })))
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    const scopedInput = screen.getByPlaceholderText('Search sessions…')
    expect(remote).toContainElement(scopedInput)
    expect(heading.compareDocumentPosition(scopedInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(listSessions).not.toHaveBeenCalledWith('local', expect.anything(), expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    listSessions.mockClear()
    const localHeading = within(active).getByRole('button', { name: 'This computer' })
    fireEvent.click(localHeading)
    expect(localHeading).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(container.querySelector('[data-sidebar-focus-actions]')! as HTMLElement).getByRole('button', { name: /Search sessions/ }))
    const allInput = screen.getByPlaceholderText('Search sessions…')
    expect(active).not.toContainElement(allInput)
    expect(allInput.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(active).getByRole('button', { name: 'This computer' })).toBeInTheDocument()
    expect(within(active).getByRole('button', { name: 'Build server' })).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Search sessions…')).toHaveLength(1)
    expect(localHeading).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith('local', focusLocal.pathKey, expect.anything()))
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith('node-1', focusRemote.projectId, expect.anything()))
    expect(listSessions).not.toHaveBeenCalledWith('node-1', focusFork.projectId, expect.anything())
    fireEvent.change(allInput, { target: { value: 'review' } })
    fireEvent.click(within(remote).getByRole('button', { name: /Search sessions/, hidden: true }))
    const movedInput = screen.getByPlaceholderText('Search sessions…')
    expect(remote).toContainElement(movedInput)
    expect(movedInput).toHaveValue('review')
    expect(container.querySelector('[data-project-focus-search="all"]')).toBeNull()
    expect(screen.getAllByPlaceholderText('Search sessions…')).toHaveLength(1)
    fireEvent.keyDown(movedInput, { key: 'Escape' })
    expect(movedInput).toHaveValue('')
    fireEvent.keyDown(movedInput, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Search sessions…')).toBeNull()
  })

  it('preselects the clicked host when opening automation from its hover action', () => {
    const { container } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    const remote = active.querySelector('[data-focus-environment="server"]')! as HTMLElement
    fireEvent.click(within(remote).getByRole('button', { name: 'New Automation', hidden: true }))
    expect(screen.getByRole('combobox', { name: 'Execution Environment' })).toHaveTextContent('Build server')
    expect(screen.getByText(focusRemote.hostPath)).toBeInTheDocument()
  })

  it('can fold an active environment independently of its settled sessions', async () => {
    const { container } = renderProject()
    const active = container.querySelector('[data-project-focus-active]')! as HTMLElement
    const local = within(active).getByRole('button', { name: /This computer/ })
    expect(local).toHaveAttribute('data-sidebar-section', 'environment')
    fireEvent.click(local)
    expect(local).toHaveAttribute('aria-expanded', 'false')
    const panel = document.getElementById(local.getAttribute('aria-controls')!)
    expect(panel).toHaveClass('grid-rows-[0fr]')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
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

  it('lists a single environment directly and keeps every checkout under one settled heading', () => {
    const copy = { ...focusLocal, pathKey: '/src/super-one-copy', hostPath: '/src/super-one-copy', projectId: 'copy' }
    const copiedSession = { ...focusSettled[0]!, sessionId: 'copy-settled', folderPath: copy.pathKey, title: 'Copy settled' }
    const { props } = renderProject({
      environments: [{ ...focusEnvironments[0]!, checkouts: [focusLocal, copy] }],
      folderSessions: { ...focusSessions, [copy.pathKey]: [focusSessionEntry('copy-active', 'Copy active')] },
      settledSessions: [...focusSettled, copiedSession],
    })
    const active = document.querySelector('[data-project-focus-active]')! as HTMLElement
    expect(within(active).queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
    expect(within(active).getByText('Copy active')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const section = document.querySelector('[data-project-focus-settled]')! as HTMLElement
    expect(within(section).queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
    expect(within(section).getByText('Local settled session')).toBeInTheDocument()
    expect(within(section).getByText('Copy settled')).toBeInTheDocument()
    fireEvent.click(within(section).getByText('Copy settled'))
    expect(props.onSwitchSession).toHaveBeenCalledWith(copy.pathKey, 'copy-settled', { revealProject: false })
  })

  it('fills the pane when the focused project has one environment', () => {
    renderProject({ environments: [focusEnvironments[0]!] })
    const list = document.querySelector('[data-active-session-list]')
    expect(list).toHaveClass('h-full')
    expect(list).not.toHaveClass('max-h-64')
  })

  it('keeps the session cap when every environment has many sessions', () => {
    const many = (prefix: string) => Array.from({ length: 12 }, (_, index) => focusSessionEntry(`${prefix}-${index}`, `Session ${index}`))
    renderProject({
      folderSessions: {
        [focusLocal.pathKey]: many('local'),
        [focusRemote.pathKey]: many('remote'),
      },
    })
    const lists = document.querySelectorAll('[data-active-session-list]')
    expect(lists).toHaveLength(2)
    for (const list of lists) {
      expect(list).toHaveClass('max-h-64')
      expect((list as HTMLElement).style.maxHeight).toBe('')
    }
  })

  it('grows the busy environment into space the quiet one leaves', async () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-project-focus-active') ? 640 : 0
    })
    try {
      renderProject({
        folderSessions: {
          ...focusSessions,
          [focusLocal.pathKey]: Array.from({ length: 20 }, (_, index) => focusSessionEntry(`local-${index}`, `Local ${index}`)),
        },
      })
      await waitFor(() => {
        const local = document.querySelectorAll('[data-active-session-list]')[0] as HTMLElement
        expect(Number.parseFloat(local.style.maxHeight)).toBeGreaterThan(256)
      })
      const remote = document.querySelectorAll('[data-active-session-list]')[1] as HTMLElement
      expect(remote.style.maxHeight).toBe('')
      expect(remote).toHaveClass('max-h-64')
    } finally {
      clientHeight.mockRestore()
    }
  })

  it('keeps active environment groups when only one of them has settled sessions', () => {
    renderProject({
      settledSessions: focusSettled.filter((session) => session.folderPath === focusLocal.pathKey),
      settledCounts: { [focusLocal.pathKey]: 21 },
    })
    const active = document.querySelector('[data-project-focus-active]')! as HTMLElement
    expect(within(active).getByRole('button', { name: /This computer/ })).toHaveAttribute('data-sidebar-section', 'environment')
    expect(within(active).getByRole('button', { name: /Build server/ })).toHaveAttribute('data-sidebar-section', 'environment')
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const section = document.querySelector('[data-project-focus-settled]')! as HTMLElement
    expect(within(section).queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
    expect(within(section).getByText('Local settled session')).toBeInTheDocument()
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
