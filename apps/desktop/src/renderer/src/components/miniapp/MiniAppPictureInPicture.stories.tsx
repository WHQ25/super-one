import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { MiniAppPictureInPicture } from './MiniAppPictureInPicture'
import { sessionProjectDir } from './miniapp-automation-targets'

const INSTANCE_KEY = 'storybook-miniapp-pip'
const TARGET_ID = 'miniapp:tasks'
const APP: MiniAppEntry = {
  id: 'tasks',
  installDir: '/apps/tasks',
  distDir: '/src/tasks/dist',
  manifest: { appId: 'tasks', name: 'Tasks', main: 'node.js' },
}

function PreviewScene() {
  const sessionId = useChatStore(selectActiveChatSessionId)
  const [narrow, setNarrow] = useState(true)
  const hidden = useMiniAppPipStore((state) => state.hidden != null)

  useEffect(() => {
    const projectDir = sessionId ? sessionProjectDir(sessionId) : null
    if (!sessionId || !projectDir) return
    useMiniAppStore.setState((state) => ({
      openApps: {
        ...state.openApps,
        [INSTANCE_KEY]: { instanceKey: INSTANCE_KEY, entry: APP, projectDir, projectId: null, holderSessions: new Set([sessionId]) },
      },
    }))
    useAgentViewfinderStore.getState().activate(sessionId, 'miniapp', TARGET_ID)
    useActivityPanelStore.getState().setShowPanel(false)
    return () => {
      useAgentViewfinderStore.getState().clear(sessionId, { kind: 'miniapp', targetId: TARGET_ID })
      useMiniAppPipStore.getState().restore()
      useMiniAppStore.setState((state) => {
        const { [INSTANCE_KEY]: _removed, ...openApps } = state.openApps
        return { openApps }
      })
    }
  }, [sessionId])

  // Changing the dock slot must not change the preview's shape while the panel is closed.
  useEffect(() => {
    useMiniAppStore.getState().updateSlot(INSTANCE_KEY, 'panel', {
      left: 0,
      top: 0,
      width: narrow ? 380 : 720,
      height: 760,
    } as DOMRectReadOnly)
  }, [narrow])

  return (
    <div className="relative min-h-screen bg-sidebar p-8" data-main-area="">
      <div className="mx-auto max-w-[1000px] space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-medium">Mini app picture in picture</h2>
            <p className="text-sm text-muted-foreground">
              An agent drives a development mini-app while the Activity panel is closed. Changing the dock slot leaves the preview at the full panel aspect. Click it to open the panel.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
              onClick={() => setNarrow((value) => !value)}
            >
              Dock slot: {narrow ? 'narrow' : 'wide'}
            </button>
            {hidden && (
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
                onClick={() => useMiniAppPipStore.getState().restore()}
              >
                Restore
              </button>
            )}
          </div>
        </div>
        <div data-chat-root="" className="relative h-[560px] rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Agent is checking the Tasks panel with browser tools.</p>
        </div>
      </div>
      {/* Storybook has no Electron webview; this paints a quiet app canvas behind the real PiP frame. */}
      <style>{'[data-miniapp-pip] { background: linear-gradient(160deg, #f4efff, #fff 60%, #eef7ff); }'}</style>
      <MiniAppPictureInPicture />
    </div>
  )
}

const meta: Meta<typeof MiniAppPictureInPicture> = {
  title: 'Mini Apps/Picture in Picture',
  component: MiniAppPictureInPicture,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof MiniAppPictureInPicture>

export const PanelAspect: Story = {
  render: () => <PreviewScene />,
}

export const Dark: Story = {
  render: () => <PreviewScene />,
  globals: { theme: 'dark' },
}
