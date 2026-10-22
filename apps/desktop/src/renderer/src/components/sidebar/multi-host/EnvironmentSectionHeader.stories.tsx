import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
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

export const Local: Story = {
  args: { label: 'This Mac', kind: 'local', onRefresh: undefined, onToggleConnection: undefined },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
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

export const Offline: Story = {
  args: { label: 'build-box', connection: 'offline', projectsStatus: 'idle' },
  render: (args) => <Frame><EnvironmentSectionHeader {...args} /></Frame>,
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
