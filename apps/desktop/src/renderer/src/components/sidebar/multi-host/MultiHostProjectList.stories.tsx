import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
import { MultiHostProjectList } from './MultiHostProjectList'

function checkout(partial: Partial<HostCheckout> & Pick<HostCheckout, 'environmentId' | 'projectId' | 'name'>): HostCheckout {
  return {
    ref: projectRef(partial.environmentId, partial.projectId),
    connectionId: partial.connectionId ?? 'local',
    pathKey: partial.pathKey ?? `/p/${partial.projectId}`,
    hostPath: partial.hostPath ?? `/p/${partial.projectId}`,
    repoIdentity: partial.repoIdentity ?? 'git:https://github.com/acme/app.git',
    addedAt: 1,
    lastOpened: 2,
    ...partial,
  }
}

function bucket(partial: Partial<EnvironmentBucket> & Pick<EnvironmentBucket, 'environmentId' | 'connectionId' | 'label'>): EnvironmentBucket {
  return {
    kind: partial.connectionId === 'local' ? 'local' : 'cli-node',
    connection: 'connected',
    projectsStatus: 'ready',
    projectsError: null,
    checkouts: [],
    ...partial,
  }
}

const local = checkout({
  environmentId: 'desktop',
  connectionId: 'local',
  projectId: 'p1',
  name: 'app',
  pathKey: '/src/app',
  hostPath: '/src/app',
})
const remote = checkout({
  environmentId: 'node-1',
  connectionId: 'cli-1',
  projectId: 'p2',
  name: 'app',
  pathKey: 'remote:cli-1:/srv/app',
  hostPath: '/srv/app',
})
const session: SessionHistoryEntry = {
  sessionId: 's1',
  title: 'Fix the catalog race',
  lastActiveAt: '2026-10-09T00:00:00.000Z',
  messageCount: 1,
}

const callbacks = {
  onToggleProject: () => {},
  onToggleEnvironment: () => {},
  onLoadMoreSessions: async () => [],
  onSwitchSession: () => {},
  onPinSession: () => {},
  onHideSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
  onEditProject: () => {},
  onRemoveProject: () => {},
  onNewSession: () => {},
  onRefreshEnvironment: () => {},
  onToggleConnection: () => {},
  onAddProject: () => {},
  connectionBusyId: null,
  refreshingConnectionId: null,
}

const meta = {
  title: 'Sidebar/MultiHostProjectList',
  component: MultiHostProjectList,
  args: {
    environments: [],
    groupBy: 'project' as const,
    sort: 'recent' as const,
    expandedProjectKeys: new Set<string>(),
    collapsedEnvironmentIds: [],
    folderSessions: {},
    folderSessionsHaveMore: {},
    loadingFolders: {},
    openingSession: null,
    draftConnectionIds: [],
    ...callbacks,
  },
} satisfies Meta<typeof MultiHostProjectList>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children }: { children: ReactNode }) {
  return <div className="h-80 w-72 overflow-auto bg-sidebar text-sidebar-foreground">{children}</div>
}

/** Two checkouts of one origin share a row. */
export const Merged: Story = {
  args: {
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', checkouts: [local] }),
      bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: [remote] }),
    ],
    expandedProjectKeys: new Set(['group:repo:github.com/acme/app', local.pathKey, remote.pathKey]),
    folderSessions: { [local.pathKey]: [session] },
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
}

export const ByEnvironment: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: [local] }),
      bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: [remote] }),
    ],
    expandedProjectKeys: new Set([local.pathKey]),
    folderSessions: { [local.pathKey]: [session] },
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const environment = canvasElement.querySelector('[data-slot="environment-row-actions"]')
    const project = canvasElement.querySelector('[data-slot="project-row-actions"]')
    await expect(environment).toBeTruthy()
    await expect(project).toBeTruthy()
    const environmentRight = environment!.getBoundingClientRect().right
    const projectRight = project!.getBoundingClientRect().right
    await expect(Math.abs(environmentRight - projectRight)).toBeLessThan(1)
    const environmentButton = environment!.querySelector('button')
    const projectButton = project!.querySelector('button')
    await expect(environmentButton?.getBoundingClientRect().width).toBe(projectButton?.getBoundingClientRect().width)
    await expect(environment).toHaveClass('invisible', 'opacity-0')
    await expect(project).toHaveClass('invisible', 'opacity-0')
  },
}

const manyLocal = Array.from({ length: 14 }, (_, index) => checkout({
  environmentId: 'desktop',
  connectionId: 'local',
  projectId: `p${index}`,
  name: `project-${index}`,
  pathKey: `/src/project-${index}`,
  hostPath: `/src/project-${index}`,
  repoIdentity: `git:project-${index}`,
}))

/** Environment and project icons share one column; nothing sticks while the list scrolls. */
export const LongList: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: manyLocal }),
      bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: [remote] }),
    ],
  },
  render: (args) => (
    <ScrollArea type="scroll" className="sidebar-scroll h-80 w-72 bg-sidebar text-sidebar-foreground">
      <MultiHostProjectList {...args} />
    </ScrollArea>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Pins and drafts are global, so an environment holds only its projects.
    await expect(canvas.queryByText('Pinned', { exact: true })).toBeNull()
    await expect(canvas.queryByText('Projects', { exact: true })).toBeNull()

    const environmentName = canvas.getByText('This Mac')
    const projectName = canvas.getByText('project-0')
    const environmentRow = environmentName.closest('.group')
    const projectRow = projectName.closest('.group')
    const environmentIcon = environmentRow?.querySelector('.lucide-monitor')
    const projectIcon = projectRow?.querySelector('.lucide-folder')
    await expect(environmentIcon).not.toBeNull()
    await expect(projectIcon).not.toBeNull()
    await expect(Math.abs(environmentIcon!.getBoundingClientRect().left - projectIcon!.getBoundingClientRect().left)).toBeLessThan(2)
    await expect(environmentRow).toHaveClass('hover:bg-sidebar-hover', 'h-9', 'px-0')
    await expect(projectRow).toHaveClass('px-0')
    await expect(canvasElement.querySelector('[data-environment-id="desktop"]')?.parentElement).toHaveClass('px-2')
    await expect(canvasElement.querySelector('[data-slot="environment-section-header"]')).toBeNull()
  },
}

export const Offline: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({
        environmentId: 'node-1',
        connectionId: 'cli-1',
        label: 'build',
        connection: 'offline',
        projectsStatus: 'idle',
      }),
    ],
    draftConnectionIds: ['cli-1'],
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
}

export const Error: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({
        environmentId: 'node-1',
        connectionId: 'cli-1',
        label: 'build',
        projectsStatus: 'error',
        projectsError: 'node refused',
      }),
    ],
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
}

export const Empty: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local' }),
    ],
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
}
