import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
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
