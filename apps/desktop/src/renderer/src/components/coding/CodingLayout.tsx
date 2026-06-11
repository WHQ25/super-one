import { useRef, useEffect, useState, useCallback, memo, lazy, Suspense } from 'react'
import { useChatStore } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { SessionSwitcherPopup } from '@/components/chat/SessionSwitcherPopup'
import { useAppStore } from '@/stores/app'
import { useTerminalStore } from '@/stores/terminal'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { closeActiveTerminal, createNewTerminal } from '@/components/coding/terminal-panel-api'
import { getDockApi } from '@/components/activity/activity-panel-api'
import { routeCloseTabShortcut } from '@/components/coding/close-tab-router'

const MIN_TERM_HEIGHT = 120

const TerminalPanel = lazy(() => import('@/components/coding/TerminalPanel').then((m) => ({ default: m.TerminalPanel })))

export const CodingLayout = memo(function CodingLayout() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const chatScopeRef = useRef<HTMLDivElement>(null)

  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
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
      routeCloseTabShortcut(document.activeElement, {
        closeTerminal: closeActiveTerminal,
        closeDock: () => getDockApi()?.activePanel?.api.close(),
        closeWindow: () => window.app.closeWindow(),
      })
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
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} />
      </div>

      <div
        className={`relative flex shrink-0 flex-col border-t border-border bg-card ${termOpen ? '' : 'hidden'}`}
        style={{ height: termHeight }}
      >
        <div
          onPointerDown={startResize}
          className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-linear-to-r from-transparent via-foreground to-transparent opacity-0 transition-opacity group-hover:opacity-40" />
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
