import { useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Plus, ArrowUp, Square } from 'lucide-react'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatMessage } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { SlashCommandOverlay } from './SlashCommandOverlay'
import { cn } from '@/lib/utils'

const OFFSET = 16
const PANEL_W = 360
const COLLAPSED_H = 44
const DEFAULT_EXPANDED_H = 450
const MIN_EXPANDED_H = 250
const MAX_EXPANDED_H = 800

type Corner = 'br' | 'bl' | 'tr' | 'tl'

/** CSS position properties for corner-anchored mode (responds to window resize) */
function cornerStyle(corner: Corner): React.CSSProperties {
  return {
    top: corner.startsWith('t') ? OFFSET : undefined,
    bottom: corner.startsWith('b') ? OFFSET : undefined,
    left: corner.endsWith('l') ? OFFSET : undefined,
    right: corner.endsWith('r') ? OFFSET : undefined,
  }
}

/** Convert a corner to absolute top/left (for drag start calculation) */
function cornerToXY(corner: Corner, panelH: number): { x: number; y: number } {
  const w = window.innerWidth
  const h = window.innerHeight
  return {
    x: corner.endsWith('l') ? OFFSET : w - PANEL_W - OFFSET,
    y: corner.startsWith('t') ? OFFSET : h - panelH - OFFSET,
  }
}

function nearestCorner(x: number, y: number): Corner {
  const w = window.innerWidth
  const h = window.innerHeight
  const isTop = y < h / 2
  const isLeft = x < w / 2
  return `${isTop ? 't' : 'b'}${isLeft ? 'l' : 'r'}` as Corner
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen)
  const corner = useChatStore((s) => s.corner)
  const setCorner = useChatStore((s) => s.setCorner)
  const toggleOpen = useChatStore((s) => s.toggleOpen)
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const resetSession = useChatStore((s) => s.resetSession)
  const interrupt = useChatStore((s) => s.interrupt)

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const compactInputRef = useRef<ChatInputHandle>(null)

  // Expanded height (user-resizable)
  const [expandedH, setExpandedH] = useState(DEFAULT_EXPANDED_H)

  // Drag state: null = not dragging (use corner CSS), {x,y} = absolute top/left
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    panelStartX: number
    panelStartY: number
    dragging: boolean
  }>({ startX: 0, startY: 0, panelStartX: 0, panelStartY: 0, dragging: false })

  // Resize state
  const [isResizing, setIsResizing] = useState(false)

  const panelH = isOpen ? expandedH : COLLAPSED_H
  const isAtTop = corner.startsWith('t')

  // Track whether user is near the bottom of the scroll area
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const handleScroll = (): void => {
      const threshold = 40
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [messages.length > 0]) // re-attach when ScrollArea mounts/unmounts

  // Auto-scroll only when user was already near the bottom (sync before paint to avoid flash)
  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // Catch async content size changes (image loads, dynamic content, etc.)
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const content = viewport.firstElementChild as HTMLElement | null
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [messages.length > 0])

  // Shift+Tab cycles permission mode
  const cyclePermissionMode = useChatStore((s) => s.cyclePermissionMode)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        cyclePermissionMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cyclePermissionMode])

  // --- Drag handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const panelXY = cornerToXY(corner, panelH)
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panelStartX: panelXY.x,
        panelStartY: panelXY.y,
        dragging: false,
      }

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragRef.current.startX
        const dy = ev.clientY - dragRef.current.startY
        if (!dragRef.current.dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          dragRef.current.dragging = true
        }
        if (dragRef.current.dragging) {
          setDragPos({
            x: dragRef.current.panelStartX + dx,
            y: dragRef.current.panelStartY + dy,
          })
        }
      }

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        if (dragRef.current.dragging) {
          const cx = dragRef.current.panelStartX + (ev.clientX - dragRef.current.startX) + PANEL_W / 2
          const cy = dragRef.current.panelStartY + (ev.clientY - dragRef.current.startY) + panelH / 2
          setCorner(nearestCorner(cx, cy))
        }
        setDragPos(null)
        requestAnimationFrame(() => {
          dragRef.current.dragging = false
        })
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [corner, panelH, setCorner]
  )

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current.dragging) {
        e.stopPropagation()
        toggleOpen()
      }
    },
    [toggleOpen]
  )

  // --- Resize handlers ---
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startY = e.clientY
      const startH = expandedH
      setIsResizing(true)

      const handleMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY
        const newH = isAtTop ? startH + dy : startH - dy
        setExpandedH(clamp(newH, MIN_EXPANDED_H, MAX_EXPANDED_H))
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        setIsResizing(false)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [expandedH, isAtTop]
  )

  // --- Position logic ---
  const isDragging = dragPos !== null
  const noTransition = isDragging || isResizing

  // When dragging: use absolute top/left. When resting: use corner CSS (auto-responsive).
  const positionStyle: React.CSSProperties = isDragging
    ? { top: dragPos.y, left: dragPos.x }
    : cornerStyle(corner)

  // Resize handle: at bottom edge for top corners, top edge for bottom corners
  const resizeHandle = isOpen && (
    <div
      onMouseDown={handleResizeMouseDown}
      className={cn(
        'absolute left-0 right-0 z-10 h-1.5 cursor-ns-resize',
        isAtTop ? 'bottom-0' : 'top-0'
      )}
    />
  )

  return (
    <div
      style={{
        ...positionStyle,
        width: PANEL_W,
        height: panelH,
        borderRadius: isOpen ? 16 : COLLAPSED_H / 2,
        position: 'fixed',
      }}
      className={cn(
        'z-50 flex flex-col overflow-hidden border border-neutral-700 shadow-2xl',
        !noTransition && 'transition-[top,right,bottom,left,height,border-radius] duration-200 ease-out'
      )}
    >
      {resizeHandle}

      {/* Header / pill bar — draggable area */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 bg-neutral-900 px-3 py-2',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ height: COLLAPSED_H }}
        onMouseDown={handleMouseDown}
      >
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleToggle}
          className="shrink-0 cursor-pointer text-neutral-400 hover:text-white"
        >
          {isOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </Button>

        {isOpen ? (
          <>
            <span className="flex-1 text-center text-sm font-medium text-neutral-200">
              New Chat
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => resetSession()}
              className="shrink-0 cursor-pointer text-neutral-400 hover:text-white"
            >
              <Plus className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <ChatInput compact ref={compactInputRef} />
            {status === 'streaming' ? (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => interrupt()}
                className="shrink-0 cursor-pointer text-neutral-400 hover:text-white"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => compactInputRef.current?.send()}
                className="shrink-0 cursor-pointer text-neutral-400 hover:text-white"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Expanded content — hidden by overflow when collapsed */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-neutral-800">
        <SlashCommandOverlay />
        <div className="flex-1 overflow-hidden">
          {messages.length === 0 ? (
            <ChatSuggestions />
          ) : (
            <ScrollArea className="h-full" viewportRef={scrollViewportRef}>
              <div className="flex flex-col gap-3 p-3">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
        <PermissionPrompt />
        <AskUserQuestionPrompt />
        <ChatInput />
      </div>
    </div>
  )
}
