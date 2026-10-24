import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { EnvironmentConnection, EnvironmentKind, LoadStatus } from '@/lib/multi-host/types'
import { EnvironmentSectionHeader } from './EnvironmentSectionHeader'

const meta = {
  title: 'Sidebar/EnvironmentSectionHeader',
  component: EnvironmentSectionHeader,
  parameters: { layout: 'centered' },
  args: {
    label: 'dev-server',
    kind: 'cli-node' as EnvironmentKind,
    connection: 'connected' as EnvironmentConnection,
    expanded: true,
    projectsStatus: 'ready' as LoadStatus,
    projectsError: null,
    onToggle: () => {},
    onRefresh: () => {},
    onToggleConnection: () => {},
    onAddProject: () => {},
  },
} satisfies Meta<typeof EnvironmentSectionHeader>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-sidebar text-sidebar-foreground" style={{ width }}>
      {children}
    </div>
  )
}

export const ConnectedCliNode: Story = {
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

export const RemoteDesktop: Story = {
  args: { label: 'MacBook-B', kind: 'remote-desktop' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

/** Reached on the LAN: Wi-Fi instead of the cloud. */
export const ConnectedOverLan: Story = {
  args: { label: 'MacBook-B', kind: 'remote-desktop', path: 'lan' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

/** Relay, SSH and Tailscale all show the cloud. */
export const ConnectedOverRelay: Story = {
  args: { path: 'relay' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

/** The machine icon and the expand chevron share one slot, the same way a project folder does. */
export const Local: Story = {
  args: { label: 'This Mac', kind: 'local', onRefresh: undefined, onToggleConnection: undefined },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('.group')
    await expect(row?.querySelector('.lucide-chevron-right')).toHaveClass('hidden', 'group-hover:block', 'rotate-90')
    await expect(row?.querySelector('.lucide-monitor')).toHaveClass('group-hover:hidden')
  },
}

export const Loading: Story = {
  args: { connection: 'connecting', projectsStatus: 'loading' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

export const Empty: Story = {
  args: { label: 'build-box', projectsStatus: 'ready' },
  render: (args) => (
    <Frame>
      <EnvironmentSectionHeader {...args} />
      <div className="px-6 py-2 text-xs text-sidebar-foreground/70">No projects on this environment.</div>
    </Frame>
  ),
}

export const ErrorRetry: Story = {
  args: { projectsStatus: 'error', projectsError: 'socket closed while listing /srv/projects' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

/** The red cloud is the disconnected mark. The row does not expand; hover offers only Connect. */
export const Offline: Story = {
  args: { label: 'build-box', connection: 'offline', projectsStatus: 'idle', onSort: () => {} },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector('.lucide-unplug')).toBeNull()
    await expect(canvasElement.querySelector('.lucide-cloud')).toHaveClass('text-error')
    await expect(canvasElement.querySelector('.lucide-chevron-right')).toHaveClass('!hidden')
    await expect(canvas.getByText('build-box').closest('button')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Add Project' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Sort Projects', hidden: true })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Connect', hidden: true })).toBeInTheDocument()
    await expect(canvasElement.querySelector('[data-slot="environment-row-actions"]')).toHaveClass('invisible', 'opacity-0', 'group-hover:opacity-100')
  },
}

export const NeedsUpgrade: Story = {
  args: { connection: 'needs-upgrade' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}

export const LongLabel: Story = {
  args: { label: 'studio-macbook-pro-16-inch-in-the-other-room' },
  render: (args) => <Frame width={220}><EnvironmentSectionHeader {...args} /></Frame>,
}

export const Narrow: Story = {
  render: (args) => <Frame width={200}><EnvironmentSectionHeader {...args} /></Frame>,
}

export const Dark: Story = {
  globals: { theme: 'dark' },
  args: { connection: 'offline', label: 'build-box' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
}
