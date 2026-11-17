import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef, useState } from 'react'
import { expect, waitFor } from 'storybook/test'
import { ChatContent } from '@/components/chat/ChatContent'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { LAYOUT } from '@/lib/layout-constants'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { ActivityPanel } from './ActivityPanel'

const START_WIDTH = LAYOUT.MIN_AP + 24

function ResizePreview({ side }: { side: 'left' | 'right' }) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const fillsWindow = useActivityPanelStore(selectPanelFillsWindow)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const { showPanel, panelWidth, userResized, side: previousSide, maximized, maximizedGroupId, chatFloating } = useActivityPanelStore.getState()
    const { isOpen } = useChatStore.getState()
    useActivityPanelStore.setState({ showPanel: true, panelWidth: START_WIDTH, side, maximized: false, maximizedGroupId: null, chatFloating: false })
    setReady(true)
    return () => {
      useActivityPanelStore.setState({ showPanel, panelWidth, userResized, side: previousSide, maximized, maximizedGroupId, chatFloating })
      useChatStore.setState({ isOpen })
    }
  }, [side])

  return (
    <div ref={workspaceRef} className="relative flex h-[520px] w-full max-w-[960px] overflow-hidden rounded-lg border border-border bg-card" style={{ minWidth: START_WIDTH + LAYOUT.MIN_MAIN + 24 }}>
      {ready && (
        <>
          <ActivityPanel getMaxWidth={() => workspaceRef.current!.clientWidth - LAYOUT.MIN_MAIN} floatChatOnResizeOverflow transitionMs={0} />
          <div className="order-1 min-h-0 flex-1 flex-col overflow-hidden" style={{ display: fillsWindow ? 'none' : 'flex', minWidth: LAYOUT.MIN_MAIN }}>
            <ChatContent scrollViewportRef={chatScrollRef} foreground={false} />
          </div>
          {fillsWindow && <ChatPanel anchorBoundaryRef={workspaceRef} />}
        </>
      )}
    </div>
  )
}

const meta = {
  title: 'Activity/Resize beside Chat',
  component: ResizePreview,
  parameters: { layout: 'fullscreen' },
  args: { side: 'left' },
  play: async ({ canvasElement, args }) => {
    const handle = await waitFor(() => {
      const element = canvasElement.querySelector('[data-activity-resize-handle]')
      expect(element).toBeVisible()
      return element!
    })
    const doc = canvasElement.ownerDocument
    const activity = canvasElement.querySelector<HTMLElement>('[data-activity-outer]')!
    const limit = activity.parentElement!.clientWidth - LAYOUT.MIN_MAIN
    const startX = Math.round(handle.getBoundingClientRect().left + 4)
    const direction = args.side === 'left' ? 1 : -1
    const limitX = startX + direction * (limit - START_WIDTH)

    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX }))
    doc.dispatchEvent(new MouseEvent('mousemove', { clientX: limitX }))
    expect(activity).toHaveStyle({ width: `${limit}px` })
    expect(canvasElement.querySelector('[data-chat-panel]')).toBeNull()

    const pastLimitX = limitX + direction * 24
    doc.dispatchEvent(new MouseEvent('mousemove', { clientX: pastLimitX }))
    doc.dispatchEvent(new MouseEvent('mouseup', { clientX: pastLimitX }))
    await waitFor(() => expect(canvasElement.querySelector('[data-chat-panel] .lucide-bot')).toBeVisible())
    expect(handle).not.toBeInTheDocument()
    expect(activity.style.width).toBe('100%')
  },
} satisfies Meta<typeof ResizePreview>

export default meta
type Story = StoryObj<typeof meta>

export const PanelOnLeft: Story = {}
export const PanelOnRight: Story = {
  args: { side: 'right' },
  globals: { theme: 'dark', locale: 'zh' },
}
