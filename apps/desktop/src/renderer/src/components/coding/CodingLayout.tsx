import { useRef, useEffect, useState, useCallback, memo, lazy, Suspense } from 'react'
import { useChatStore } from '@/stores/chat'
import { SessionPane } from '@/components/chat/SessionPane'
import { SessionSwitcherPopup } from '@/components/chat/SessionSwitcherPopup'
import { useAppStore } from '@/stores/app'
import { useTerminalStore } from '@/stores/terminal'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { closeActiveTerminal, createNewTerminal } from '@/components/coding/terminal-panel-api'
import { getDockApi, closeBrowserTab, closeActivityTerminalTab } from '@/components/activity/activity-panel-api'
import { useMiniAppStore } from '@/stores/miniapp'
import { routeCloseTabShortcut } from '@/components/coding/close-tab-router'
import { ResizeHandleLine } from '@/components/ResizeHandleLine'

const MIN_TERM_HEIGHT = 120

const TerminalPanel = lazy(() => import('@/components/coding/TerminalPanel').then((m) => ({ default: m.TerminalPanel })))

// Closing the active dock tab is not a plain `api.close()`: browser/mini-app/terminal
// tabs keep their real content (webview, iframe instance, PTY) in fixed host-layer
// overlays or the main process, so a bare panel close would orphan them. Dispatch by
// panel-id prefix to the same teardown each tab's ✕ button uses.
function closeActiveDockTab(): void {
  const panel = getDockApi()?.activePanel
  if (!panel) return
  const id = panel.id
  if (id.startsWith('miniapp-')) void useMiniAppStore.getState().closeApp(id.slice('miniapp-'.length))
  else if (id.startsWith('terminal-')) closeActivityTerminalTab(id.slice('terminal-'.length))
  else if (id.startsWith('file:')) panel.api.close()
  else closeBrowserTab(id)
}

export const CodingLayout = memo(function CodingLayout() {
  const chatScopeRef = useRef<HTMLDivElement>(null)

  useChatKeyboardShortcuts()

  const { open: termOpen, toggle: toggleTerminal } = useTerminalPanel()
  const [termHeight, setTermHeight] = useState(300)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const hasTerminals = useTerminalStore((s) => (currentFolder ? (s.byProject[currentFolder]?.tabs.length ?? 0) : 0) > 0)
  const [termEverActive, setTermEverActive] = useState(false)
  useEffect(() => { if (termOpen || hasTerminals) setTermEverActive(true) }, [termOpen, hasTerminals])

  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleTerminal()
      } else if (
        e.key === 't' &&
        (e.metaKey || e.ctrlKey) &&
        document.activeElement?.closest('.xterm')
      ) {
        e.preventDefault()
        createNewTerminal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTerminal])

  useEffect(() => {
    return window.app.onCloseTabShortcut(() => {
      routeCloseTabShortcut(
        document.activeElement,
        {
          closeTerminal: closeActiveTerminal,
          closeDock: closeActiveDockTab,
          closeWindow: () => window.app.closeWindow(),
        },
        getDockApi()?.activePanel != null,
      )
    })
  }, [])

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = termHeight
    const maxH = () => Math.round(window.innerHeight * 0.8)
    const onMove = (ev: PointerEvent): void => {
      const next = Math.min(maxH(), Math.max(MIN_TERM_HEIGHT, startH + (startY - ev.clientY)))
      setTermHeight(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [termHeight])

  return (
    <div ref={chatScopeRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <SessionPane />

      <div
        className={`coding-terminal-surface relative flex shrink-0 flex-col border-t border-border bg-card ${termOpen ? '' : 'hidden'}`}
        style={{ height: termHeight }}
      >
        <div
          onPointerDown={startResize}
          className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        >
          <ResizeHandleLine orientation="horizontal" />
        </div>
        <div className="min-h-0 flex-1">
          {termEverActive && (
            <Suspense fallback={null}>
              <TerminalPanel />
            </Suspense>
          )}
        </div>
      </div>

      <SessionSwitcherPopup scopeRef={chatScopeRef} />
    </div>
  )
})
