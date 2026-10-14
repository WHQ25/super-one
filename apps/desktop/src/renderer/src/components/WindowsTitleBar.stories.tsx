import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { LayoutToggle } from './coding/LayoutToggle'
import { WindowsTitleBar } from './WindowsTitleBar'

interface PreviewProps {
  panel?: 'left' | 'right' | 'closed' | 'maximized'
  sidebarOpen?: boolean
  workspace?: boolean
  glass?: boolean
  width?: number
}

/** Real title bar and controls, with workspace regions to make their actions visible. */
function Preview({ panel = 'left', sidebarOpen = true, workspace = true, glass = false, width = 800 }: PreviewProps) {
  const [ready, setReady] = useState(false)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const side = useActivityPanelStore((s) => s.side)
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const maximized = useActivityPanelStore((s) => s.maximized)

  useLayoutEffect(() => {
    const original = window.app
    const root = document.documentElement
    const originalPlatform = root.dataset.platform
    const originalGlass = root.classList.contains('liquid-glass')
    const originalGlassSetting = useAppStore.getState().liquidGlass
    window.app = new Proxy(original, {
      get: (target, key, receiver) => key === 'platform' ? 'win32' : Reflect.get(target, key, receiver),
    })
    root.dataset.platform = 'win32'
    root.classList.toggle('liquid-glass', glass)
    useAppStore.setState({ showSidebar: sidebarOpen, liquidGlass: glass })
    useActivityPanelStore.setState({ showPanel: panel !== 'closed', side: panel === 'right' ? 'right' : 'left', maximized: panel === 'maximized' })
    setReady(true)
    return () => {
      window.app = original
      if (originalPlatform === undefined) delete root.dataset.platform
      else root.dataset.platform = originalPlatform
      root.classList.toggle('liquid-glass', originalGlass)
      useAppStore.setState({ liquidGlass: originalGlassSetting })
    }
  }, [panel, sidebarOpen, glass])

  if (!ready) return null
  return (
    <div data-windows-titlebar-preview className="flex h-72 w-full flex-col overflow-hidden rounded-lg border border-border bg-sidebar" style={{ maxWidth: width }}>
      <WindowsTitleBar showLayoutControls={workspace} />
      <div className="flex min-h-0 flex-1">
        {workspace && showSidebar && <aside className="w-32 shrink-0 p-3 text-xs text-sidebar-foreground">Sidebar</aside>}
        <div className="m-1 mt-0 flex min-w-0 flex-1 overflow-hidden rounded-lg bg-card text-card-foreground">
          {workspace ? <>
            {!maximized && <section data-preview-chat className="flex min-w-0 flex-1 flex-col text-xs" style={{ order: 1 }}>
              <div data-preview-chat-header className="flex h-[34px] shrink-0 items-center border-b border-border px-2 text-muted-foreground">
                <LayoutToggle />
                Chat header
              </div>
              <div className="min-h-0 flex-1 p-3">Chat</div>
            </section>}
            {showPanel && <section data-preview-activity className={cn('flex flex-col border-x border-border text-xs', maximized ? 'flex-1' : 'w-1/3')} style={{ order: side === 'left' ? 0 : 2 }}>
              <div data-preview-activity-header className="flex h-[34px] shrink-0 items-center border-b border-border px-2 text-muted-foreground">Activity panel</div>
              <div className="min-h-0 flex-1 bg-muted/30 p-3">{maximized ? 'Maximized panel' : 'Panel content'}</div>
            </section>}
          </> : <div className="p-4 text-sm">Settings</div>}
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Desktop/WindowsTitleBar',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const SidebarCollapsed: Story = { args: { sidebarOpen: false } }
export const PanelOnRight: Story = { args: { panel: 'right' } }
export const PanelClosed: Story = { args: { panel: 'closed' } }
export const PanelMaximized: Story = { args: { panel: 'maximized' } }
export const Settings: Story = { args: { workspace: false } }
export const Dark: Story = { globals: { theme: 'dark' } }
export const Glass: Story = { args: { glass: true } }
export const DarkGlass: Story = { args: { glass: true }, globals: { theme: 'dark' } }
export const NarrowChinese: Story = { args: { width: 360, sidebarOpen: false }, globals: { theme: 'dark', locale: 'zh' } }
