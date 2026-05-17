import { useRef, useEffect, useState, useCallback, memo } from 'react'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatContent } from '@/components/chat/ChatContent'
import { SessionSwitcherPopup } from '@/components/chat/SessionSwitcherPopup'
import { TerminalPanel } from '@/components/coding/TerminalPanel'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'

const MIN_TERM_HEIGHT = 120

export const CodingLayout = memo(function CodingLayout() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const chatScopeRef = useRef<HTMLDivElement>(null)

  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
  useChatKeyboardShortcuts()

  const termOpen = useAppStore((s) => s.terminalOpen)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const [termHeight, setTermHeight] = useState(300)

  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTerminal])

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
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
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
          <TerminalPanel />
        </div>
      </div>

      <SessionSwitcherPopup scopeRef={chatScopeRef} />
    </div>
  )
})
