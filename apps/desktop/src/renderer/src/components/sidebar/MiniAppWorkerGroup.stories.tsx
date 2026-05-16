import type { Meta, StoryObj } from '@storybook/react-vite'
import type { MiniAppWorkerInfo } from '@superone/shared/miniapp-types'
import { MiniAppWorkerGroup } from './MiniAppWorkerGroup'

const now = Date.now()

function worker(p: Partial<MiniAppWorkerInfo> & { appId: string }): MiniAppWorkerInfo {
  return { projectDir: '/storybook/super-one', name: p.appId, since: now, ...p }
}

function StoryHost({ workers }: { workers: MiniAppWorkerInfo[] }) {
  return (
    <div className="w-72 rounded-md border border-sidebar-border bg-sidebar py-1.5 text-sidebar-foreground">
      <MiniAppWorkerGroup workers={workers} onOpen={() => {}} onStop={() => {}} />
    </div>
  )
}

const meta: Meta<typeof StoryHost> = {
  title: 'Sidebar/MiniAppWorkerGroup',
  component: StoryHost,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof StoryHost>

export const StatusText: Story = {
  name: 'Worker-pushed status text',
  args: {
    workers: [
      worker({ appId: 'downloader', name: '下载助手', statusText: 'Downloading 3/8' }),
      worker({ appId: 'sync', name: '数据同步', statusText: '正在同步…' }),
    ],
  },
}

export const UptimeFallback: Story = {
  name: 'Uptime fallback (no status text)',
  args: {
    workers: [
      worker({ appId: 'just-started', name: 'Just started', since: now - 5_000 }),
      worker({ appId: 'minutes', name: 'Indexer', since: now - 70_000 }),
      worker({ appId: 'hours', name: 'Long runner', since: now - (2 * 3600 + 5 * 60) * 1000 }),
    ],
  },
}

export const Mixed: Story = {
  name: 'Mixed: status text + uptime',
  args: {
    workers: [
      worker({ appId: 'downloader', name: '下载助手', statusText: 'Downloading 3/8' }),
      worker({ appId: 'sync', name: '数据同步', since: now - 12 * 60_000 }),
      worker({ appId: 'watcher', name: 'File watcher', since: now - 30_000 }),
    ],
  },
}

export const Overflow: Story = {
  name: 'Long name + long status (truncation)',
  args: {
    workers: [
      worker({ appId: 'a', name: 'A mini app with an extremely long display name that overflows', statusText: 'Processing a very long status message that should be ellipsized' }),
      worker({ appId: 'b', name: 'Short', since: now - 90_000 }),
    ],
  },
}

export const Single: Story = {
  name: 'Single worker',
  args: { workers: [worker({ appId: 'solo', name: 'Solo worker', since: now - 45_000 })] },
}
