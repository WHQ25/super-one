import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import { useLayoutEffect } from 'react'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { CalendarClock, Search, SquarePen } from 'lucide-react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ActiveSessionList } from './ActiveSessionList'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import { SidebarFocusView, type SidebarFocusViewProps, focusLevelIcon, projectFocusIcon, SidebarFocusBar, type FocusSwitchItem } from './SidebarFocusView'
import {
  applySidebarFocus,
  focusEnvironment,
  focusProject,
  focusSession,
  sidebarFocusCrumbs,
  useSidebarFocusStore,
  type SidebarFocus,
} from './sidebar-focus'

import { focusEnvironments, focusFork, focusLocal, focusRemote, focusSessions, focusSessionEntry, focusSettled } from './project-focus.fixtures'

const ENVIRONMENT = 'Build machine'
const PROJECT = 'Payments reconciliation workspace'

const parent: SessionHistoryEntry = {
  sessionId: 'parent',
  title: 'Opening workflow',
  lastActiveAt: '2026-10-09T00:00:00.000Z',
  messageCount: 1,
  provider: 'claude',
  childCount: 1,
}

const callbacks = {
  onSwitchSession: () => {},
  onPinSession: () => {},
  onSettleSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
  onToggleExpand: () => {},
  onEditProject: () => {},
  onRemoveProject: () => {},
  onNewSession: () => {},
}

function barModel(target: SidebarFocus): { title: string; levels: FocusSwitchItem[]; siblings: FocusSwitchItem[] } {
  const environmentLabel = target.environmentId === 'env-billing' ? 'Billing' : ENVIRONMENT
  const projectLabel = target.kind !== 'environment' && target.folderPath === '/storybook/billing' ? 'Billing' : PROJECT
  const crumbs = sidebarFocusCrumbs(target, {
    root: 'Exit Focus',
    environment: environmentLabel,
    project: projectLabel,
    session: 'Opening workflow',
  })
  const levels = crumbs
    .filter((crumb) => !crumb.current)
    .map((crumb) => ({
      id: crumb.id,
      label: crumb.label,
      icon: focusLevelIcon({ id: crumb.id }),
      onSelect: () => applySidebarFocus(crumb.target),
    }))
  const siblings = target.kind === 'environment'
    ? [
        { id: 'env-build', label: ENVIRONMENT, current: target.environmentId === 'env-build', icon: focusLevelIcon({ id: 'environment', environment: { kind: 'local', connection: 'connected' } }), onSelect: () => focusEnvironment('env-build') },
        { id: 'env-billing', label: 'Billing', current: target.environmentId === 'env-billing', icon: focusLevelIcon({ id: 'environment', environment: { kind: 'cli-node', connection: 'connected' } }), onSelect: () => focusEnvironment('env-billing') },
      ]
    : target.kind === 'project'
      ? [
          { id: '/storybook/focus', label: PROJECT, current: target.folderPath === '/storybook/focus', icon: projectFocusIcon({ open: target.folderPath === '/storybook/focus' }), onSelect: () => focusProject('/storybook/focus', 'env-build') },
          { id: '/storybook/billing', label: 'Billing', current: target.folderPath === '/storybook/billing', icon: projectFocusIcon({ open: target.folderPath === '/storybook/billing' }), onSelect: () => focusProject('/storybook/billing', 'env-build') },
        ]
      : [
          { id: 'parent', label: 'Opening workflow', current: target.sessionId === 'parent', onSelect: () => {} },
          { id: 'notes', label: 'Release notes', current: target.sessionId === 'notes', onSelect: () => {} },
        ]
  return { title: crumbs.find((crumb) => crumb.current)?.label ?? '', levels, siblings }
}

function projectActions() {
  return (
    <>
      <IconButton size="sm" variant="nested" tooltip="Search sessions…"><Search /></IconButton>
      <IconButton size="sm" variant="nested" tooltip="New Automation"><CalendarClock /></IconButton>
      <IconButton size="sm" variant="nested" tooltip="New Session"><SquarePen /></IconButton>
    </>
  )
}

function FocusChrome() {
  const target = useSidebarFocusStore((state) => state.target)
  useLayoutEffect(() => {
    applySidebarFocus({ kind: 'project', folderPath: '/storybook/focus', environmentId: 'env-build' })
    return () => applySidebarFocus(null)
  }, [])
  const model = target ? barModel(target) : { title: '', levels: [], siblings: [] }
  return (
    <div data-sidebar-focus data-sidebar-inner className="flex h-[480px] w-[288px] flex-col bg-sidebar text-sidebar-foreground">
      <SidebarFocusBar
        title={model.title}
        siblings={model.siblings}
        levels={model.levels}
        menuLabel={target?.kind === 'environment' ? 'Select Environment' : target?.kind === 'session' ? 'Select Session' : 'Select Project'}
        onAddProject={target?.kind === 'project' ? () => {} : undefined}
        actions={target?.kind === 'project' ? projectActions() : undefined}
      />
      {target?.kind === 'project' && target.folderPath === '/storybook/focus' && (
        <div className="flex min-h-0 flex-1 flex-col px-2">
          <ProjectSidebarRow
            {...callbacks}
            folder={{
              id: 'focus',
              name: PROJECT,
              path: '/storybook/focus',
              addedAt: '2026-10-09T00:00:00.000Z',
              lastOpened: '2026-10-09T00:00:00.000Z',
            }}
            sessions={[parent]}
            sessionsOnly
            isExpanded
            sessionListLayout="fill"
            focusEnvironmentId="env-build"
          />
        </div>
      )}
      {target?.kind === 'project' && target.folderPath !== '/storybook/focus' && (
        <div className="px-3 py-2 text-xs">Billing</div>
      )}
      {target?.kind === 'environment' && (
        <div className="px-3 py-2 text-xs">Projects</div>
      )}
      {target?.kind === 'session' && (
        <div className="px-3 py-2 text-xs">Children of {target.sessionId}</div>
      )}
    </div>
  )
}

function FillList() {
  return (
    <div data-sidebar-inner className="flex h-[480px] w-[288px] flex-col bg-sidebar text-sidebar-foreground">
      <SidebarFocusBar
        title="super-one"
        siblings={[{ id: 'super-one', label: 'super-one', current: true, icon: projectFocusIcon({ open: true }), onSelect: () => {} }]}
        levels={[{ id: 'root', label: 'Exit Focus', icon: focusLevelIcon({ id: 'root' }), onSelect: () => {} }]}
        actions={projectActions()}
      />
      <ActiveSessionList layout="fill">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="px-2.5 py-1.5 text-xs">Session {index}</div>
        ))}
      </ActiveSessionList>
    </div>
  )
}

const meta = {
  title: 'Sidebar/SidebarFocus',
  component: FocusChrome,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FocusChrome>
export default meta
type Story = StoryObj<typeof meta>

export const Project: Story = {
  render: () => <FocusChrome />,
}

export const Levels: Story = {
  render: () => <FocusChrome />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const actions = canvasElement.querySelector('[data-sidebar-focus-actions]')
    await expect(actions?.className ?? '').not.toContain('opacity-0')
    await expect(canvas.getByRole('button', { name: 'Search sessions…' })).toBeVisible()
    const levels = canvas.getByRole('button', { name: 'Focus Levels' })
    levels.focus()
    await userEvent.hover(levels)
    await userEvent.click(canvas.getByRole('button', { name: ENVIRONMENT }))
    await expect(canvasElement.querySelector('[data-sidebar-focus-title]')).toHaveTextContent(ENVIRONMENT)
    await userEvent.click(canvas.getByRole('button', { name: ENVIRONMENT }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Billing' }))
    await expect(canvasElement.querySelector('[data-sidebar-focus-title]')).toHaveTextContent('Billing')
  },
}

export const DarkLevels: Story = {
  render: () => (
    <div className="dark bg-sidebar">
      <FocusChrome />
    </div>
  ),
}

export const FilledList: Story = {
  render: () => <FillList />,
  play: async ({ canvasElement }) => {
    const list = canvasElement.querySelector('[data-active-session-list]')
    await expect(list).toBeTruthy()
    await expect(list).toHaveClass('h-full')
    await expect(list?.className ?? '').not.toContain('max-h-64')
    await expect(list!.getBoundingClientRect().height).toBeGreaterThan(400)
  },
}

export const Drill: Story = {
  render: () => <FocusChrome />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector('[data-sidebar-focus-title]')).toHaveTextContent(PROJECT)
    await userEvent.dblClick(canvas.getByText('Opening workflow'))
    await expect(canvasElement.querySelector('[data-sidebar-focus-title]')).toHaveTextContent('Opening workflow')
    canvas.getByRole('button', { name: 'Focus Levels' }).focus()
    await expect(canvas.getByRole('button', { name: PROJECT })).toBeVisible()
    await expect(canvas.getByText('Children of parent')).toBeInTheDocument()
  },
}

const environmentSessionCreated = fn()
function CrossEnvironmentFocus({ state = 'ready', narrow = false, crowded = false, single = false }: { state?: 'ready' | 'loading' | 'offline' | 'empty'; narrow?: boolean; crowded?: boolean; single?: boolean }) {
  useLayoutEffect(() => {
    environmentSessionCreated.mockClear()
    const previousEnvironments = useMultiHostSidebarStore.getState().environments
    useMultiHostSidebarStore.setState({ environments: focusEnvironments })
    mockIpc('environment', 'listProjects', async () => focusEnvironments[1]!.checkouts.map((checkout) => ({ projectId: checkout.projectId, path: checkout.hostPath })))
    mockIpc('environment', 'listSessions', async (_connection, projectId) => Object.entries(focusSessions).find(([path]) => path === projectId || (projectId === focusRemote.projectId && path === focusRemote.pathKey))?.[1] ?? [])
    focusProject(focusLocal.pathKey, focusLocal.environmentId)
    return () => { applySidebarFocus(null); useMultiHostSidebarStore.setState({ environments: previousEnvironments }) }
  }, [])
  const props: SidebarFocusViewProps = {
    ...callbacks,
    onNewSession: environmentSessionCreated,
    environments: (single ? focusEnvironments.slice(0, 1) : focusEnvironments).map((bucket) => bucket.kind === 'local' ? bucket : {
      ...bucket,
      label: narrow ? 'Build server with a very long environment name' : bucket.label,
      connection: state === 'offline' ? 'offline' : 'connected',
    }),
    folders: [], localHostLabel: 'This computer', sort: 'recent', expandedProjectKeys: new Set(),
    folderSessions: state === 'loading' ? {} : state === 'empty' ? { [focusLocal.pathKey]: [], [focusRemote.pathKey]: [] } : focusSessions,
    settledSessions: state === 'empty' ? [] : focusSettled,
    settledCounts: { [focusLocal.pathKey]: 21, [focusRemote.pathKey]: 32 },
    loadingFolders: state === 'loading' ? { [focusRemote.pathKey]: true } : {},
    openingSession: null, connectionBusyId: null, refreshingConnectionId: null,
    onLoadFolderSessions: () => {}, onToggleProject: () => {},
    onLoadMoreSessions: () => {}, onLoadMoreSettled: () => {},
    onRefreshEnvironment: () => {}, onToggleConnection: () => {}, onAddProject: () => {},
  }
  if (state === 'empty') props.settledCounts = {}
  if (crowded) {
    props.folderSessions = Object.fromEntries([focusLocal, focusRemote].map((checkout) => [checkout.pathKey,
      Array.from({ length: 60 }, (_, index) => focusSessionEntry(`${checkout.connectionId}-${index}`, `Session ${index}: a long title that should truncate within the sidebar`)),
    ]))
    props.settledSessions = [focusLocal, focusRemote].flatMap((checkout) => Array.from({ length: 40 }, (_, index) => ({
      ...focusSessionEntry(`${checkout.connectionId}-settled-${index}`, `Finished session ${index}`),
      folderPath: checkout.pathKey, folderName: checkout.name, isSettled: true,
    })))
    props.settledCounts = { [focusLocal.pathKey]: 40, [focusRemote.pathKey]: 40 }
  }
  return (
    <div data-sidebar-inner className="flex h-[540px] flex-col bg-sidebar text-sidebar-foreground" style={{ width: narrow ? 220 : 288 }}>
      <SidebarFocusView {...props} />
    </div>
  )
}

export const CrossEnvironment: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Local active session')).toBeVisible()
    await expect(canvas.getByText('Remote active session')).toBeVisible()
    await expect(canvas.queryByText('Unrelated fork session')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Settled/ }))
    const settled = canvasElement.querySelector('[data-project-focus-settled]') as HTMLElement
    await expect(within(settled).getByRole('button', { name: /Build server/ })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(within(settled).getByRole('button', { name: /Build server/ }))
    await expect(within(settled).getByText('Remote settled session')).toBeVisible()
    const active = canvasElement.querySelector('[data-project-focus-active]')!
    await expect(settled.getBoundingClientRect().top).toBeGreaterThan(active.getBoundingClientRect().top)
  },
}

export const CrossEnvironmentDark: Story = {
  ...CrossEnvironment,
  globals: { theme: 'dark' },
}

export const NewSessionFromEnvironment: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => {
    const active = canvasElement.querySelector('[data-project-focus-active]') as HTMLElement
    for (const checkout of [focusLocal, focusRemote]) {
      const group = active.querySelector(`[data-focus-environment="${checkout.environmentId}"]`) as HTMLElement
      const heading = group.querySelector('[data-sidebar-section="environment"]') as HTMLElement
      const create = within(group).getByLabelText(/New Session|新建会话/)
      await userEvent.unhover(group)
      await expect(create).not.toBeVisible()
      heading.focus()
      await expect(create).toBeVisible()
      await userEvent.tab()
      await expect(within(group).getByLabelText(/Search sessions|搜索会话/)).toHaveFocus()
      await userEvent.tab()
      await expect(within(group).getByLabelText(/New Automation|新建自动化/)).toHaveFocus()
      await userEvent.tab()
      await expect(create).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect(environmentSessionCreated).toHaveBeenLastCalledWith(checkout.pathKey)
      await expect(heading).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(heading)
      await userEvent.click(create)
      await expect(heading).toHaveAttribute('aria-expanded', 'false')
      await expect(environmentSessionCreated).toHaveBeenLastCalledWith(checkout.pathKey)
      await userEvent.click(heading)
      heading.blur()
    }
    await expect(useSidebarFocusStore.getState().target).toEqual({
      kind: 'project', folderPath: focusLocal.pathKey, environmentId: focusLocal.environmentId,
    })
  },
}

export const NewSessionFromEnvironmentDark: Story = {
  ...NewSessionFromEnvironment,
  globals: { theme: 'dark' },
}

export const NewSessionFromEnvironmentNarrow: Story = {
  ...NewSessionFromEnvironment,
  render: () => <CrossEnvironmentFocus narrow />,
  globals: { locale: 'zh' },
}

export const EnvironmentActions: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const active = canvasElement.querySelector('[data-project-focus-active]') as HTMLElement
    const remote = active.querySelector('[data-focus-environment="server"]') as HTMLElement
    await userEvent.click(within(remote).getByLabelText('Search sessions…'))
    await expect(within(remote).getByPlaceholderText('Search sessions…')).toBeVisible()
    await userEvent.type(within(remote).getByPlaceholderText('Search sessions…'), 'Remote')
    await expect(within(remote).getByText('Remote active session')).toBeVisible()
    await userEvent.click(within(remote).getByRole('button', { name: 'Close' }))
    await userEvent.click(within(remote).getByLabelText('New Automation'))
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('combobox', { name: 'Execution Environment' })).toHaveTextContent('Build server')
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    const barActions = canvasElement.querySelector('[data-sidebar-focus-actions]') as HTMLElement
    await userEvent.click(within(barActions).getByLabelText('Search sessions…'))
    await expect(canvasElement.querySelector('[data-project-focus-search="all"]')).toBeVisible()
    await userEvent.type(canvas.getByPlaceholderText('Search sessions…'), 'active')
    await expect(canvas.getByText('Local active session')).toBeVisible()
    await expect(canvas.getByText('Remote active session')).toBeVisible()
    await expect(canvas.queryByText('Unrelated fork session')).not.toBeInTheDocument()
  },
}

export const EnvironmentActionsDark: Story = { ...EnvironmentActions, globals: { theme: 'dark' } }

export const SearchAllEnvironments: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const actions = canvasElement.querySelector('[data-sidebar-focus-actions]') as HTMLElement
    await userEvent.click(within(actions).getByLabelText('Search sessions…'))
    const input = canvas.getByPlaceholderText('Search sessions…')
    const active = canvasElement.querySelector('[data-project-focus-active]')!
    await expect(active.contains(input)).toBe(false)
    const local = active.querySelector('[data-focus-environment="desktop"] [data-sidebar-section]')!
    await expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(local.getBoundingClientRect().top)
    await userEvent.type(input, 'active')
    await expect(canvas.getByText('Local active session')).toBeVisible()
    await expect(canvas.getByText('Remote active session')).toBeVisible()
    await expect(canvas.getAllByPlaceholderText('Search sessions…')).toHaveLength(1)
  },
}

async function searchOneEnvironment(canvasElement: HTMLElement, environmentId: string) {
  const group = canvasElement.querySelector(`[data-project-focus-active] [data-focus-environment="${environmentId}"]`) as HTMLElement
  const heading = group.querySelector('[data-sidebar-section]') as HTMLElement
  await userEvent.click(within(group).getByLabelText('Search sessions…'))
  const input = within(group).getByPlaceholderText('Search sessions…')
  await expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(heading.getBoundingClientRect().bottom)
  await userEvent.type(input, 'active')
  await expect(within(group).getByText(environmentId === 'desktop' ? 'Local active session' : 'Remote active session')).toBeVisible()
  await expect(within(canvasElement).getAllByPlaceholderText('Search sessions…')).toHaveLength(1)
}

export const SearchThisComputer: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => searchOneEnvironment(canvasElement, 'desktop'),
}
export const SearchBuildServer: Story = {
  render: () => <CrossEnvironmentFocus />,
  play: async ({ canvasElement }) => searchOneEnvironment(canvasElement, 'server'),
}
export const SearchAllEnvironmentsDark: Story = { ...SearchAllEnvironments, globals: { theme: 'dark' } }
export const SearchThisComputerDark: Story = { ...SearchThisComputer, globals: { theme: 'dark' } }
export const SearchBuildServerDark: Story = { ...SearchBuildServer, globals: { theme: 'dark' } }

export const CrossEnvironmentNarrow: Story = {
  render: () => <CrossEnvironmentFocus narrow />,
  globals: { locale: 'zh' },
}

export const CrossEnvironmentLoading: Story = {
  render: () => <CrossEnvironmentFocus state="loading" />,
}

export const CrossEnvironmentOffline: Story = {
  render: () => <CrossEnvironmentFocus state="offline" />,
}

export const CrossEnvironmentEmpty: Story = {
  render: () => <CrossEnvironmentFocus state="empty" />,
}

/** One checkout host: sessions and Settled sit directly under the project, with no environment heading. */
export const OneEnvironment: Story = {
  render: () => <CrossEnvironmentFocus single />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Local active session')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Settled/ }))
    const settled = canvasElement.querySelector('[data-project-focus-settled]') as HTMLElement
    await expect(within(settled).queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
    await expect(within(settled).getByText('Local settled session')).toBeVisible()
  },
}

export const OneEnvironmentDark: Story = {
  ...OneEnvironment,
  globals: { theme: 'dark' },
}

export const CrossEnvironmentOverflow: Story = {
  render: () => <CrossEnvironmentFocus crowded />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Settled/ }))
    const settled = canvasElement.querySelector('[data-project-focus-settled]') as HTMLElement
    for (const name of [/This computer/, /Build server/]) {
      await userEvent.click(within(settled).getByRole('button', { name }))
    }
    const pane = canvasElement.querySelector('[data-sidebar-inner]')!
    await expect(settled.getBoundingClientRect().bottom).toBeLessThanOrEqual(pane.getBoundingClientRect().bottom)
    await expect(settled.getBoundingClientRect().height).toBeLessThanOrEqual(pane.getBoundingClientRect().height / 2)
  },
}

const parentFocusOpened = fn()
function ParentSessionFocus({ state = 'ready', narrow = false, single = false }: { state?: 'ready' | 'empty' | 'offline' | 'loading' | 'error'; narrow?: boolean; single?: boolean }) {
  useLayoutEffect(() => {
    parentFocusOpened.mockClear()
    const listSessions = window.environment.listSessions
    mockIpc('environment', 'listSessions', state === 'loading'
      ? () => new Promise(() => {})
      : state === 'error' ? async () => { throw new Error('Temporary connection failure') } : async () => [])
    focusSession(focusLocal.pathKey, 'parent', focusLocal.environmentId)
    return () => { applySidebarFocus(null); mockIpc('environment', 'listSessions', (...args) => Reflect.apply(listSessions, window.environment, args)) }
  }, [state])
  const hosts = single ? [focusLocal] : [focusLocal, focusRemote, focusFork]
  const childSessions = Object.fromEntries(hosts.map((checkout) => [checkout.pathKey, {
    parent: state === 'empty' ? [] : [{
      ...focusSessionEntry(`child-${checkout.projectId}`, checkout === focusLocal ? 'Review SDK upgrade' : checkout === focusRemote ? 'Run integration tests' : 'Verify companion project'),
      parentSessionId: 'parent',
    }],
  }]))
  const props: SidebarFocusViewProps = {
    ...callbacks, onSwitchSession: parentFocusOpened,
    environments: (single ? focusEnvironments.slice(0, 1) : focusEnvironments).map((bucket) => state === 'offline' && bucket.kind !== 'local' ? { ...bucket, connection: 'offline' } : bucket),
    folders: [], localHostLabel: 'This computer', sort: 'recent', expandedProjectKeys: new Set(),
    folderSessions: { [focusLocal.pathKey]: [focusSessionEntry('parent', 'Upgrade Claude Agent SDK and adapt SuperOne')] },
    childSessions: state === 'loading' || state === 'error' ? {} : childSessions,
    loadingFolders: {}, openingSession: null, connectionBusyId: null, refreshingConnectionId: null,
    onLoadFolderSessions: () => {}, onToggleProject: () => {}, onRefreshEnvironment: () => {}, onToggleConnection: () => {}, onAddProject: () => {},
  }
  return <div data-sidebar-inner className="flex h-[480px] flex-col bg-sidebar text-sidebar-foreground" style={{ width: narrow ? 220 : 320 }}>
    <SidebarFocusView {...props} />
  </div>
}

export const ParentSession: Story = {
  render: () => <ParentSessionFocus />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvasElement.querySelector('[data-sidebar-focus-title]')!
    await expect(title.querySelector('.lucide-message-square')).toBeTruthy()
    await userEvent.click(title)
    await expect(parentFocusOpened).toHaveBeenCalledWith(focusLocal.pathKey, 'parent', { revealProject: false })
    await expect(canvas.getByRole('button', { name: /This computer/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Build server/ })).toBeVisible()
    await userEvent.click(canvas.getByText('Run integration tests'))
    await expect(parentFocusOpened).toHaveBeenCalledWith(focusRemote.pathKey, `child-${focusRemote.projectId}`, { revealProject: false })
  },
}
/** One host has children, so they sit directly under the parent with no environment heading. */
export const ParentSessionOneEnvironment: Story = {
  render: () => <ParentSessionFocus single />,
  play: async ({ canvasElement }) => {
    const children = canvasElement.querySelector('[data-session-focus-children]') as HTMLElement
    await expect(within(children).getByText('Review SDK upgrade')).toBeVisible()
    await expect(within(children).queryByRole('button', { name: /This computer/ })).not.toBeInTheDocument()
  },
}

export const ParentSessionOneEnvironmentDark: Story = {
  ...ParentSessionOneEnvironment,
  globals: { theme: 'dark' },
}

export const ParentSessionDark: Story = { ...ParentSession, globals: { theme: 'dark' } }
export const ParentSessionNarrow: Story = { render: () => <ParentSessionFocus narrow />, globals: { locale: 'zh' } }
export const ParentSessionOffline: Story = { render: () => <ParentSessionFocus state="offline" /> }
export const ParentSessionEmpty: Story = { render: () => <ParentSessionFocus state="empty" /> }
export const ParentSessionLoading: Story = { render: () => <ParentSessionFocus state="loading" /> }
export const ParentSessionError: Story = { render: () => <ParentSessionFocus state="error" /> }
