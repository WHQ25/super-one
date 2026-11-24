import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SidebarFrame } from '@/components/sidebar/SidebarFrame'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { ACTIVITY_PANEL_TRANSITION, LAYOUT } from '@/lib/layout-constants'
import { cancelSidebarChatLock } from '@/lib/layout-actions'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { ActivityPanel } from './ActivityPanel'
import { cn } from '@superone/ui/lib/utils'

interface PreviewProps {
  side: 'left' | 'right'
  initialSidebarOpen?: boolean
  width?: number
}

function SidebarTogglePreview({ side, initialSidebarOpen = true, width = 1280 }: PreviewProps) {
  const showSidebar = useAppStore((s) => s.showSidebar)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const lockedChatWidth = useActivityPanelStore((s) => s.lockedChatWidth)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const prevApp = useAppStore.getState()
    const prevAp = useActivityPanelStore.getState()
    cancelSidebarChatLock()
    useAppStore.setState({ showSidebar: initialSidebarOpen, sidebarWidth: LAYOUT.MIN_SIDEBAR })
    useActivityPanelStore.setState({
      showPanel: true,
      side,
      panelWidth: initialSidebarOpen ? 460 : 460 + LAYOUT.MIN_SIDEBAR - LAYOUT.CARD_INSET,
      maximized: false,
      maximizedGroupId: null,
      chatFloating: false,
      lockedChatWidth: null,
    })
    setReady(true)
    return () => {
      cancelSidebarChatLock()
      useAppStore.setState({ showSidebar: prevApp.showSidebar, sidebarWidth: prevApp.sidebarWidth })
      useActivityPanelStore.setState({
        showPanel: prevAp.showPanel,
        side: prevAp.side,
        panelWidth: prevAp.panelWidth,
        maximized: prevAp.maximized,
        maximizedGroupId: prevAp.maximizedGroupId,
        chatFloating: prevAp.chatFloating,
        lockedChatWidth: null,
      })
    }
  }, [side, initialSidebarOpen])

  if (!ready) return null

  return (
    <div
      className="flex h-[520px] overflow-hidden bg-sidebar text-foreground"
      style={{ width }}
    >
      <div className="relative flex shrink-0">
        <SidebarFrame open={showSidebar} width={sidebarWidth}>
          <div className="flex h-full flex-col p-3 text-xs text-sidebar-foreground">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-medium">Sidebar</span>
              <LayoutToggle />
            </div>
            <div className="rounded-md bg-muted/40 p-2 text-muted-foreground">Projects & Sessions</div>
          </div>
        </SidebarFrame>
      </div>

      <div
        data-main-content=""
        data-card-inset="true"
        style={{
          transition: `margin-left ${ACTIVITY_PANEL_TRANSITION.durationMs}ms ${ACTIVITY_PANEL_TRANSITION.easing}`,
        }}
        className={cn(
          'relative flex min-w-0 flex-1 overflow-hidden rounded-xl bg-card my-[5px] mr-[5px]',
          !showSidebar && 'ml-[5px]',
        )}
      >
        <ActivityPanel getMaxWidth={() => width - (showSidebar ? sidebarWidth : 0) - LAYOUT.MIN_MAIN} />
        <div
          data-main-area=""
          className={cn(
            'relative flex min-w-0 flex-1 flex-col overflow-hidden p-4',
            side === 'left' ? 'border-l border-border' : 'border-r border-border',
          )}
          style={{
            order: 1,
            minWidth: LAYOUT.MIN_MAIN,
            ...(lockedChatWidth !== null ? { flex: `0 1 ${lockedChatWidth}px` } : {}),
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            {!showSidebar && side === 'right' && <LayoutToggle />}
            <span className="text-sm font-medium">Docked Chat</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Toggling the sidebar should only resize the activity panel while keeping this docked chat column completely steady without width jitter.
          </p>
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Activity/Sidebar Toggle with Docked Chat',
  component: SidebarTogglePreview,
  parameters: { layout: 'fullscreen' },
  args: { side: 'left', initialSidebarOpen: true, width: 1280 },
  play: async ({ canvasElement }) => {
    const mainArea = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>('[data-main-area]')
      expect(el).toBeVisible()
      return el!
    })
    const initialChatWidth = Math.round(mainArea.getBoundingClientRect().width)
    const button = within(canvasElement).getByRole('button', { name: /toggle sidebar|切换侧边栏/i })
    await userEvent.click(button)
    expect(useActivityPanelStore.getState().lockedChatWidth).not.toBeNull()
    expect(Math.round(mainArea.getBoundingClientRect().width)).toBe(initialChatWidth)
    await waitFor(() => expect(useActivityPanelStore.getState().lockedChatWidth).toBeNull(), { timeout: 1000 })
    expect(Math.round(mainArea.getBoundingClientRect().width)).toBe(initialChatWidth)
  },
} satisfies Meta<typeof SidebarTogglePreview>

export default meta
type Story = StoryObj<typeof meta>

export const ActivityOnLeft: Story = {}
export const ActivityOnRight: Story = {
  args: { side: 'right' },
  globals: { theme: 'dark', locale: 'zh' },
}
export const NarrowLayout: Story = {
  args: { side: 'left', width: 1080 },
}
