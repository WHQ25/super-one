import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { MultiHostEnvironmentScroll } from './MultiHostEnvironmentScroll'
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
  onSwitchSession: () => {},
  onPinSession: () => {},
  onSettleSession: () => {},
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
    loadingFolders: {},
    openingSession: null,
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
    const remoteViewport = canvasElement.querySelector<HTMLElement>('[data-environment-id="node-1"] [data-environment-project-list] [data-slot="scroll-area-viewport"]')!
    await expect(remoteViewport.clientHeight).toBe(36)
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
const manyRemote = Array.from({ length: 10 }, (_, index) => checkout({
  environmentId: 'node-1',
  connectionId: 'cli-1',
  projectId: `r${index}`,
  name: `remote-${index}`,
  pathKey: `remote:cli-1:/srv/remote-${index}`,
  hostPath: `/srv/remote-${index}`,
  repoIdentity: `git:remote-${index}`,
}))

/** Each device's projects scroll independently beneath its name. */
export const LongList: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', kind: 'local', checkouts: manyLocal }),
      bucket({ environmentId: 'node-1', connectionId: 'cli-1', label: 'build', checkouts: manyRemote }),
    ],
  },
  render: (args) => (
    <div className="h-80 w-72 bg-sidebar text-sidebar-foreground">
      <MultiHostEnvironmentScroll {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Pinned', { exact: true })).toBeNull()
    await expect(canvas.queryByText('Projects', { exact: true })).toBeNull()

    const pin = canvasElement.querySelector<HTMLElement>('[data-slot="pinned-device-name"]')
    const environmentName = within(pin!).getByText('This Mac')
    const projectName = canvas.getByText('project-0')
    const environmentRow = environmentName.closest('.group')
    const projectRow = projectName.closest('.group')
    const environmentIcon = environmentRow?.querySelector('.lucide-monitor')
    const projectIcon = projectRow?.querySelector('.lucide-folder')
    await expect(environmentIcon).not.toBeNull()
    await expect(projectIcon).not.toBeNull()
    await expect(projectIcon!.getBoundingClientRect().left - environmentIcon!.getBoundingClientRect().left).toBe(8)
    await expect(environmentRow).toHaveClass('hover:bg-sidebar-hover', 'h-9', 'px-1.5')
    await expect(projectRow).toHaveClass('pl-2.5', 'pr-1.5')
    await expect(canvasElement.querySelector('[data-environment-id="desktop"]')?.parentElement).toHaveClass('px-2')

    const pinnedHeader = pin!.querySelector<HTMLElement>('[data-slot="environment-section-header"]')
    const viewport = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    await expect(pinnedHeader).not.toBeNull()
    await expect(viewport).not.toBeNull()
    await expect(viewport).toHaveClass('scroll-edge-fade-y')
    const projects = canvasElement.querySelector<HTMLElement>('[data-environment-id="desktop"] [data-environment-project-list] [data-slot="scroll-area-viewport"]')
    await expect(projects).not.toBeNull()
    await expect(projects!.clientHeight).toBe(256)
    await expect(projects!.scrollHeight).toBeGreaterThan(projects!.clientHeight)
    await expect(projects).toHaveClass('scroll-edge-fade-y')
    const nextHeader = canvasElement.querySelector<HTMLElement>('[data-environment-id="node-1"] > [data-slot="environment-section-header"]')!
    const nextTop = nextHeader.getBoundingClientRect().top
    projects!.scrollTop = 100
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await expect(projects!.scrollTop).toBe(100)
    await expect(viewport!.scrollTop).toBe(0)
    await expect(nextHeader.getBoundingClientRect().top).toBe(nextTop)

    // A wheel at the project list's edge continues through the outer sidebar.
    projects!.scrollTop = projects!.scrollHeight
    projects!.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    await expect(viewport!.scrollTop).toBe(40)
    viewport!.scrollTop = 0
    projects!.scrollTop = 0
    const fill = getComputedStyle(pinnedHeader!).backgroundColor
    await expect(fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent').toBe(true)
    await expect(pinnedHeader!.className).not.toContain('bg-')
    const frame = pin!.parentElement
    await expect(frame).toHaveClass('pt-1')
    await expect(pin).toHaveClass('top-1')
    const listGap = pin!.getBoundingClientRect().top - frame!.getBoundingClientRect().top
    await expect(listGap).toBeGreaterThan(3)
    await expect(listGap).toBeLessThan(6)

    const pinTop = pin!.getBoundingClientRect().top
    viewport!.scrollTop = 160
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await expect(Math.abs(pin!.getBoundingClientRect().top - pinTop)).toBeLessThan(1)
    const band = pin!.getBoundingClientRect()
    const hit = document.elementFromPoint(band.left + band.width / 2, band.top + band.height / 2)
    await expect(pin!.contains(hit)).toBe(true)

    viewport!.scrollTop = viewport!.scrollHeight
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // With capped projects the next device is visible before its name reaches the pin.
    await expect(nextHeader.getBoundingClientRect().top).toBeGreaterThanOrEqual(viewport!.getBoundingClientRect().top)
    await expect(nextHeader.getBoundingClientRect().bottom).toBeLessThan(viewport!.getBoundingClientRect().bottom)
    viewport!.scrollTop = 0
  },
}

export const NarrowLongList: Story = {
  ...LongList,
  render: (args) => (
    <div className="h-80 w-56 bg-sidebar text-sidebar-foreground">
      <MultiHostEnvironmentScroll {...args} />
    </div>
  ),
}

/** Session wheels pass into the project's list before the outer sidebar. */
export const LongListWithSessions: Story = {
  ...LongList,
  args: {
    ...LongList.args,
    expandedProjectKeys: new Set([manyLocal[0]!.pathKey]),
    folderSessions: {
      [manyLocal[0]!.pathKey]: Array.from({ length: 16 }, (_, index) => ({
        ...session,
        sessionId: `long-session-${index}`,
        title: `Session ${index + 1}`,
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const projects = canvasElement.querySelector<HTMLElement>('[data-environment-id="desktop"] [data-environment-project-list] [data-slot="scroll-area-viewport"]')!
    const sessions = projects.querySelector<HTMLElement>('[data-active-session-list] [data-slot="scroll-area-viewport"]')!
    const sidebar = canvasElement.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    await expect(projects.clientHeight).toBe(256)
    await expect(sessions.scrollHeight).toBeGreaterThan(sessions.clientHeight)
    sessions.scrollTop = sessions.scrollHeight
    sessions.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    await expect(projects.scrollTop).toBe(40)
    await expect(sidebar.scrollTop).toBe(0)
    projects.scrollTop = projects.scrollHeight
    sessions.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    await expect(sidebar.scrollTop).toBe(40)
    projects.scrollTop = 0
    sessions.scrollTop = 0
    sidebar.scrollTop = 0
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
  },
  render: (args) => <Frame><MultiHostProjectList {...args} /></Frame>,
}

export const Loading: Story = {
  args: {
    groupBy: 'environment',
    environments: [
      bucket({ environmentId: 'desktop', connectionId: 'local', label: 'This Mac', projectsStatus: 'loading' }),
    ],
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
