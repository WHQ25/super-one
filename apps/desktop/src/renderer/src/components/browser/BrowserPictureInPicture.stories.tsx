import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { BrowserPictureInPicture } from './BrowserPictureInPicture'

const BROWSER_ID = 'storybook-browser-pip'

function PreviewScene({ mobile = false, lateChat = false }: { mobile?: boolean; lateChat?: boolean }) {
  const sessionId = useChatStore(selectActiveChatSessionId)
  const [narrow, setNarrow] = useState(true)
  const [chatKey, setChatKey] = useState<number | null>(lateChat ? null : 0)

  useEffect(() => {
    if (!sessionId) return
    const browser = useBrowserStore.getState()
    browser.ensure(BROWSER_ID, 'https://example.com', sessionId)
    browser.markAutomationPreviewReady(BROWSER_ID)
    browser.setEmulation(BROWSER_ID, mobile ? { width: 390, height: 844 } : null)
    useAgentViewfinderStore.getState().activate(sessionId, 'browser', BROWSER_ID)
    useActivityPanelStore.getState().setShowPanel(false)

    return () => {
      useAgentViewfinderStore.getState().clear(sessionId, { kind: 'browser', targetId: BROWSER_ID })
      useBrowserStore.getState().remove(BROWSER_ID)
    }
  }, [mobile, sessionId])

  useEffect(() => {
    if (!sessionId) return
    useBrowserStore.getState().updateSlot(BROWSER_ID, 'panel', {
      left: 0,
      top: 0,
      width: narrow ? 420 : 980,
      height: 680,
    } as DOMRectReadOnly)
  }, [narrow, sessionId])

  return (
    <div className="relative min-h-screen bg-sidebar p-8" data-main-area="">
      <div className="mx-auto max-w-[1000px] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Browser picture in picture</h2>
            <p className="text-sm text-muted-foreground">The floating preview keeps its shape as the tab panel changes width.</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            onClick={() => setNarrow((value) => !value)}
          >
            Panel: {narrow ? 'narrow' : 'wide'}
          </button>
        </div>
        <button
          type="button"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          onClick={() => setChatKey((key) => (key ?? -1) + 1)}
        >
          {chatKey == null ? 'Finish loading chat' : 'Replace chat pane'}
        </button>
        {chatKey == null ? (
          <div className="h-[560px] rounded-xl border border-border bg-card p-6" role="status">Loading chat…</div>
        ) : (
          <div key={chatKey} data-chat-root="" className="relative h-[560px] rounded-xl border border-border bg-card p-6" style={{ width: chatKey % 2 ? '85%' : undefined }}>
            <p className="text-sm text-muted-foreground">Agent is using the browser in the background.</p>
          </div>
        )}
      </div>
      {/* Storybook has no Electron webview; this paints a quiet page canvas behind the real PiP frame. */}
      <style>{'[data-browser-pip] { background: linear-gradient(145deg, #eaf3ff, #fff 65%, #e8f8f2); }'}</style>
      <BrowserPictureInPicture />
    </div>
  )
}

const meta: Meta<typeof BrowserPictureInPicture> = {
  title: 'Browser/Picture in Picture',
  component: BrowserPictureInPicture,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof BrowserPictureInPicture>

export const MaximizedBrowserAspect: Story = {
  render: () => <PreviewScene />,
}

export const EmulatedMobile: Story = {
  render: () => <PreviewScene mobile />,
}

export const Dark: Story = {
  render: () => <PreviewScene />,
  globals: { theme: 'dark' },
}

/** The target is ready before the chat; finishing loading must reveal the PiP. */
export const LateChatMount: Story = {
  render: () => <PreviewScene lateChat />,
}
