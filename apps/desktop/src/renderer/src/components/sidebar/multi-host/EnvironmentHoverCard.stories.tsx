import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { EnvironmentHoverBody } from './EnvironmentHoverCard'

const GIB = 1024 ** 3
const memory = {
  totalBytes: 64 * GIB,
  freeBytes: 64 * GIB - Math.round(18.4 * GIB),
}
const cpu = { percent: 23, model: 'Apple M3 Max' }

const meta = {
  title: 'Sidebar/EnvironmentHoverCard',
  component: EnvironmentHoverBody,
  parameters: { layout: 'centered' },
  args: {
    label: 'dev-server',
    kind: 'cli-node',
    connection: 'connected',
    path: 'lan',
    projectCount: 3,
    details: {
      machineOs: 'macOS 26.0',
      platform: { os: 'darwin', arch: 'arm64' },
      memory,
      cpu,
    },
    onEdit: () => {},
  },
} satisfies Meta<typeof EnvironmentHoverBody>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ children, width = 288 }: { children: ReactNode; width?: number }) {
  return (
    <div className="bg-popover p-3 text-popover-foreground" style={{ width }}>
      {children}
    </div>
  )
}

export const ConnectedNode: Story = {
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('dev-server')).toBeInTheDocument()
    await expect(canvasElement.querySelector('[data-slot="environment-device-icon"] .lucide-server')).toBeInTheDocument()
    await expect(canvas.getByText('Node · Connected')).toBeInTheDocument()
    await expect(canvas.getByText('3 Projects')).toBeInTheDocument()
    await expect(canvas.getByText('macOS 26.0')).toBeInTheDocument()
    await expect(canvas.getByText('45.6GB Free')).toBeInTheDocument()
    await expect(canvas.getByText('Apple M3 Max · 23%')).toBeInTheDocument()
    await expect(canvas.queryByText('LAN')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Environment Settings' })).toBeInTheDocument()
  },
}

/** The title is this computer's name. The kind line is not the same monitor glyph as the OS line. */
export const LocalComputer: Story = {
  args: {
    label: 'MacBook Pro',
    kind: 'local',
    path: null,
    projectCount: 1,
    details: { platform: { os: 'darwin', arch: 'arm64' }, memory, cpu: { percent: 12, model: 'Apple M1 Max', cores: 10 } },
  },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('MacBook Pro')).toBeInTheDocument()
    await expect(canvasElement.querySelector('[data-slot="environment-device-icon"] .lucide-laptop')).toBeInTheDocument()
    await expect(canvas.getByText('This Computer').closest('div')?.querySelector('.lucide-computer')).toBeTruthy()
    await expect(canvas.getByText('This Computer')).toBeInTheDocument()
    await expect(canvas.queryByText(/Connected/)).not.toBeInTheDocument()
    await expect(canvas.getByText('macOS · arm64').closest('div')?.querySelector('.lucide-monitor')).toBeTruthy()
    await expect(canvas.getByText('macOS · arm64')).toBeInTheDocument()
    await expect(canvas.getByText('45.6GB Free')).toBeInTheDocument()
    await expect(canvas.getByText('Apple M1 Max · 12%')).toBeInTheDocument()
    await expect(canvas.getByText('1 Project')).toBeInTheDocument()
    await expect(canvas.queryByText('LAN')).not.toBeInTheDocument()
  },
}

/** Offline shows the chip and installed memory saved while connected. */
export const Offline: Story = {
  args: {
    label: 'build-box',
    connection: 'offline',
    path: null,
    projectCount: null,
    details: {
      platform: { os: 'linux', arch: 'x64' },
      machineOs: 'Ubuntu 24.04 LTS',
      cpu: { model: 'AMD EPYC 9454' },
      memory: { totalBytes: 64 * GIB, freeBytes: null },
    },
  },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Node · Offline')).toBeInTheDocument()
    await expect(canvas.getByText('Ubuntu 24.04 LTS')).toBeInTheDocument()
    await expect(canvas.getByText('AMD EPYC 9454')).toBeInTheDocument()
    await expect(canvas.getByText('64GB')).toBeInTheDocument()
    await expect(canvas.queryByText(/Free/)).not.toBeInTheDocument()
    await expect(canvas.queryByText(/%/)).not.toBeInTheDocument()
    await expect(canvas.queryByText(/Project/)).not.toBeInTheDocument()
  },
}

export const NeedsUpgrade: Story = {
  args: { connection: 'needs-upgrade', path: 'relay' },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
}

export const RemoteDesktop: Story = {
  args: { label: 'MacBook-B', kind: 'remote-desktop', path: 'tailscale', projectCount: 0 },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot="environment-device-icon"] .lucide-monitor')).toBeInTheDocument()
    await expect(within(canvasElement).getByText('Remote Desktop · Connected')).toBeInTheDocument()
  },
}

/** System and memory are still being read. */
export const LoadingDetails: Story = {
  args: { details: null, waiting: true },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.animate-spin')).toBeInTheDocument()
    await expect(within(canvasElement).queryByText('macOS 26.0')).not.toBeInTheDocument()
  },
}

export const LongLabel: Story = {
  args: { label: 'studio-macbook-pro-16-inch-in-the-other-room' },
  render: (args) => <Frame width={220}><EnvironmentHoverBody {...args} /></Frame>,
}

export const Narrow: Story = {
  render: (args) => <Frame width={200}><EnvironmentHoverBody {...args} /></Frame>,
}

export const Dark: Story = {
  globals: { theme: 'dark' },
  args: { connection: 'offline', label: 'build-box', path: null, projectCount: null },
  render: (args) => <Frame><EnvironmentHoverBody {...args} /></Frame>,
}
