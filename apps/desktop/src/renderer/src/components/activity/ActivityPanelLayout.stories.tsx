import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'
import { WindowsTitleBar } from '@/components/WindowsTitleBar'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { ActivityPanel } from './ActivityPanel'
import { getDockApi, maximizeActivityTab, openNewFileTab, splitActivityTab } from './activity-panel-api'

interface PreviewProps {
  platform?: 'darwin' | 'win32'
  direction?: 'right' | 'below'
  maximized?: boolean
  fullscreen?: boolean
  sidebarOpen?: boolean
  width?: number
}

function Preview({ platform = 'darwin', fullscreen = false, sidebarOpen = false, width = 1000 }: PreviewProps) {
  const [ready, setReady] = useState(false)
  const showSidebar = useAppStore((s) => s.showSidebar)
  useLayoutEffect(() => {
    const original = window.app
    const previous = useAppStore.getState()
    window.app = new Proxy(original, {
      get(target, key, receiver) {
        if (key === 'platform') return platform
        if (key === 'getFullscreen') return async () => fullscreen
        if (key === 'getGitDiffFile') return async (_root: string, path: string) => ({ path, diff: '' })
        if (key === 'getMediaServerPort') return async () => 6016
        if (key === 'readProjectFile') return async (_root: string, path: string) => ({
          path,
          content: `# ${path}\n\nSplit this tab or maximize it to inspect the window controls.`,
          language: 'markdown',
        })
        return Reflect.get(target, key, receiver)
      },
    })
    useAppStore.setState({ showSidebar: sidebarOpen, currentFolder: '/storybook/project' })
    useActivityPanelStore.setState({ showPanel: true, side: 'left', panelWidth: width - (sidebarOpen ? 180 : 0), maximized: false, maximizedGroupId: null })
    setReady(true)
    return () => {
      window.app = original
      useAppStore.setState({ showSidebar: previous.showSidebar, currentFolder: previous.currentFolder })
    }
  }, [platform, fullscreen, sidebarOpen, width])

  if (!ready) return null
  return (
    <div data-split-header-preview="" className="flex h-[520px] w-full flex-col overflow-hidden rounded-lg border border-border bg-card" style={{ maxWidth: width }}>
      <WindowsTitleBar showLayoutControls />
      <div className="relative flex min-h-0 flex-1">
        {showSidebar && <aside className="w-[180px] shrink-0 bg-sidebar p-3 text-sidebar-foreground">Sidebar</aside>}
        <ActivityPanel getMaxWidth={() => width} transitionMs={0} />
      </div>
    </div>
  )
}

const meta = {
  title: 'Activity/Split Header Controls',
  component: Preview,
  parameters: { layout: 'padded' },
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(getDockApi()).not.toBeNull())
    openNewFileTab('README.md')
    openNewFileTab('CLAUDE.md')
    splitActivityTab('file:CLAUDE.md', args.direction ?? 'right')
    if (args.maximized) maximizeActivityTab('file:CLAUDE.md')
    const canvas = within(canvasElement)
    const expected = args.sidebarOpen && args.platform !== 'win32' ? 0 : 1
    await waitFor(() => expect(canvas.queryAllByRole('button', { name: /toggle sidebar|切换侧边栏/i })).toHaveLength(expected))
    if (args.platform === 'win32') {
      expect(within(canvasElement.querySelector<HTMLElement>('[data-activity-outer]')!).queryByRole('button', { name: /toggle sidebar|切换侧边栏/i })).toBeNull()
      expect(canvasElement.querySelector('[data-traffic-light-padding]')).toBeNull()
    } else {
      const api = getDockApi()!
      const owner = api.getPanel(args.maximized ? 'file:CLAUDE.md' : 'file:README.md')!.group
      for (const group of api.groups) {
        expect(within(group.element).queryAllByRole('button', { name: /toggle sidebar|切换侧边栏/i })).toHaveLength(group === owner ? expected : 0)
      }
      expect(canvasElement.querySelectorAll('[data-traffic-light-padding]')).toHaveLength(args.fullscreen ? 0 : expected)
    }
    canvasElement.querySelector<HTMLElement>('[data-split-header-preview]')!.dataset.verified = 'true'
  },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

export const MacLeftRight: Story = {}
export const MacTopBottom: Story = { args: { direction: 'below' } }
export const MacMaximized: Story = { args: { maximized: true } }
export const MacFullscreen: Story = { args: { fullscreen: true } }
export const MacSidebarOpen: Story = { args: { sidebarOpen: true } }
export const MacDark: Story = { globals: { theme: 'dark' } }
export const MacNarrowChinese: Story = { args: { direction: 'below', width: 440 }, globals: { theme: 'dark', locale: 'zh' } }
export const Windows: Story = { args: { platform: 'win32' } }
export const WindowsSidebarOpen: Story = { args: { platform: 'win32', sidebarOpen: true } }
export const WindowsDark: Story = { args: { platform: 'win32' }, globals: { theme: 'dark' } }
export const MacEmpty: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(getDockApi()).not.toBeNull())
    expect(within(canvasElement).getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
    canvasElement.querySelector<HTMLElement>('[data-split-header-preview]')!.dataset.verified = 'true'
  },
}
