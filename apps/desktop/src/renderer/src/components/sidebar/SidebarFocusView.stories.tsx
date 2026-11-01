import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { CalendarClock, Search, SquarePen } from 'lucide-react'
import { expect, screen, userEvent, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { ActiveSessionList } from './ActiveSessionList'
import { ProjectSidebarRow } from './ProjectSidebarRow'
import { focusLevelIcon, projectFocusIcon, SidebarFocusBar, type FocusSwitchItem } from './SidebarFocusView'
import {
  applySidebarFocus,
  focusEnvironment,
  focusProject,
  sidebarFocusCrumbs,
  useSidebarFocusStore,
  type SidebarFocus,
} from './sidebar-focus'

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
