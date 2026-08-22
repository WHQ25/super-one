import type { Meta, StoryObj } from '@storybook/react-vite'
import type { MiniAppHostInfo } from '@superone/shared/miniapp-types'
import { MiniAppHostGroup } from './MiniAppHostGroup'

const now = Date.now()

function host(p: Partial<MiniAppHostInfo> & { appId: string }): MiniAppHostInfo {
  return { projectDir: '/storybook/super-one', name: p.appId, since: now, ready: true, ...p }
}

function StoryHost({ hosts }: { hosts: MiniAppHostInfo[] }) {
  return (
    <div className="w-72 rounded-md border border-sidebar-border bg-sidebar py-1.5 text-sidebar-foreground">
      <MiniAppHostGroup hosts={hosts} onOpen={() => {}} onStop={() => {}} />
    </div>
  )
}

const meta: Meta<typeof StoryHost> = {
  title: 'Sidebar/MiniAppHostGroup',
  component: StoryHost,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof StoryHost>

export const StatusText: Story = {
  name: 'Host-pushed status text',
  args: {
    hosts: [
      host({ appId: 'downloader', name: '下载助手', statusText: 'Downloading 3/8' }),
      host({ appId: 'sync', name: '数据同步', statusText: '正在同步…' }),
    ],
  },
}

export const UptimeFallback: Story = {
  name: 'Uptime fallback (no status text)',
  args: {
    hosts: [
      host({ appId: 'just-started', name: 'Just started', since: now - 5_000 }),
      host({ appId: 'minutes', name: 'Indexer', since: now - 70_000 }),
      host({ appId: 'hours', name: 'Long runner', since: now - (2 * 3600 + 5 * 60) * 1000 }),
    ],
  },
}

export const Mixed: Story = {
  name: 'Mixed: status text + uptime',
  args: {
    hosts: [
      host({ appId: 'downloader', name: '下载助手', statusText: 'Downloading 3/8' }),
      host({ appId: 'sync', name: '数据同步', since: now - 12 * 60_000 }),
      host({ appId: 'watcher', name: 'File watcher', since: now - 30_000 }),
    ],
  },
}

export const Overflow: Story = {
  name: 'Long name + long status (truncation)',
  args: {
    hosts: [
      host({ appId: 'a', name: 'A mini app with an extremely long display name that overflows', statusText: 'Processing a very long status message that should be ellipsized' }),
      host({ appId: 'b', name: 'Short', since: now - 90_000 }),
    ],
  },
}

export const Single: Story = {
  name: 'Single host',
  args: { hosts: [host({ appId: 'solo', name: 'Solo host', since: now - 45_000 })] },
}
