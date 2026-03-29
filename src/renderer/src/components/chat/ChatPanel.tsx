import { useRef, useCallback, useEffect, useState } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Plus, ArrowUp, Square, Clock } from 'lucide-react'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatContent } from './ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'
import { cn } from '@/lib/utils'

const OFFSET = 16
const TITLEBAR_H = 44
const TOP_OFFSET = TITLEBAR_H + 8
const DEFAULT_PANEL_W = 360
const MIN_PANEL_W = 360
const MAX_PANEL_W = 800
const COLLAPSED_H = 44
const DEFAULT_EXPANDED_H = 620
const MIN_EXPANDED_H = 580
const maxExpandedH = () => Math.floor(window.innerHeight * 0.9)

type Corner = 'br' | 'bl' | 'tr' | 'tl'

/** CSS position properties for corner-anchored mode (responds to window resize) */
function cornerStyle(corner: Corner): React.CSSProperties {
  return {
    top: corner.startsWith('t') ? TOP_OFFSET : undefined,
    bottom: corner.startsWith('b') ? OFFSET : undefined,
    left: corner.endsWith('l') ? OFFSET : undefined,
    right: corner.endsWith('r') ? OFFSET : undefined,
  }
}

/** Convert a corner to absolute top/left (for drag start calculation) */
function cornerToXY(corner: Corner, panelW: number, panelH: number): { x: number; y: number } {
  const w = window.innerWidth
  const h = window.innerHeight
  return {
    x: corner.endsWith('l') ? OFFSET : w - panelW - OFFSET,
    y: corner.startsWith('t') ? TOP_OFFSET : h - panelH - OFFSET,
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
  const status = useActiveSession((s) => s.status)
  const resetSession = useChatStore((s) => s.resetSession)
  const interrupt = useChatStore((s) => s.interrupt)
  const toggleHistory = useChatStore((s) => s.toggleHistory)

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const compactInputRef = useRef<ChatInputHandle>(null)

  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
  useChatKeyboardShortcuts()

  // Panel dimensions (user-resizable)
  const [expandedH, setExpandedH] = useState(() => Math.min(DEFAULT_EXPANDED_H, maxExpandedH()))
  const [panelW, setPanelW] = useState(DEFAULT_PANEL_W)

  // Clamp panel height when window resizes
  useEffect(() => {
    const handleResize = () => {
      setExpandedH((h) => clamp(h, MIN_EXPANDED_H, maxExpandedH()))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  // --- Drag handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const panelXY = cornerToXY(corner, panelW, panelH)
      let nextDragPos = panelXY
      let raf = 0
      const flush = () => {
        raf = 0
        setDragPos(nextDragPos)
      }
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
          nextDragPos = {
            x: dragRef.current.panelStartX + dx,
            y: dragRef.current.panelStartY + dy,
          }
          if (raf === 0) raf = requestAnimationFrame(flush)
        }
      }

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        cancelAnimationFrame(raf)
        raf = 0
        if (dragRef.current.dragging) {
          const cx = dragRef.current.panelStartX + (ev.clientX - dragRef.current.startX) + panelW / 2
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
    [corner, panelW, panelH, setCorner]
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
  const isAtLeft = corner.endsWith('l')

  const handleResizeYMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startY = e.clientY
      const startH = expandedH
      let nextH = startH
      let raf = 0
      const flush = () => {
        raf = 0
        setExpandedH(nextH)
      }
      setIsResizing(true)

      const handleMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY
        const newH = isAtTop ? startH + dy : startH - dy
        nextH = clamp(newH, MIN_EXPANDED_H, maxExpandedH())
        if (raf === 0) raf = requestAnimationFrame(flush)
      }

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        cancelAnimationFrame(raf)
        const dy = ev.clientY - startY
        const finalH = isAtTop ? startH + dy : startH - dy
        setExpandedH(clamp(finalH, MIN_EXPANDED_H, maxExpandedH()))
        setIsResizing(false)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [expandedH, isAtTop]
  )

  const handleResizeXMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = panelW
      let nextW = startW
      let raf = 0
      const flush = () => {
        raf = 0
        setPanelW(nextW)
      }
      setIsResizing(true)

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const newW = isAtLeft ? startW + dx : startW - dx
        nextW = clamp(newW, MIN_PANEL_W, MAX_PANEL_W)
        if (raf === 0) raf = requestAnimationFrame(flush)
      }

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        cancelAnimationFrame(raf)
        const dx = ev.clientX - startX
        const finalW = isAtLeft ? startW + dx : startW - dx
        setPanelW(clamp(finalW, MIN_PANEL_W, MAX_PANEL_W))
        setIsResizing(false)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [panelW, isAtLeft]
  )

  // --- Position logic ---
  const isDragging = dragPos !== null
  const noTransition = isDragging || isResizing

  // When dragging: use absolute top/left. When resting: use corner CSS (auto-responsive).
  const positionStyle: React.CSSProperties = isDragging
    ? { top: dragPos.y, left: dragPos.x }
    : cornerStyle(corner)

  // Resize handles: vertical (top/bottom edge) + horizontal (left/right edge)
  const resizeHandles = isOpen && (
    <>
      <div
        onMouseDown={handleResizeYMouseDown}
        className={cn(
          'absolute left-0 right-0 z-10 h-1.5 cursor-ns-resize',
          isAtTop ? 'bottom-0' : 'top-0'
        )}
      />
      <div
        onMouseDown={handleResizeXMouseDown}
        className={cn(
          'absolute top-0 bottom-0 z-10 w-1.5 cursor-ew-resize',
          isAtLeft ? 'right-0' : 'left-0'
        )}
      />
    </>
  )

  return (
    <div
      style={{
        ...positionStyle,
        width: panelW,
        height: panelH,
        borderRadius: isOpen ? 16 : COLLAPSED_H / 2,
        position: 'fixed',
      }}
      className={cn(
        '@container z-50 flex flex-col overflow-hidden border border-border shadow-2xl',
        !noTransition && 'transition-[top,right,bottom,left,width,height,border-radius] duration-200 ease-out'
      )}
    >
      {resizeHandles}

      {/* Header / pill bar — draggable area */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 bg-background px-3 py-2',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ height: COLLAPSED_H }}
        onMouseDown={handleMouseDown}
      >
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleToggle}
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          {isOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </Button>

        {isOpen ? (
          <>
            <div className="flex-1" />
            <div
              onClick={toggleHistory}
              className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Clock className="size-4" />
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => resetSession()}
              className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
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
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <Square className="size-3" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => compactInputRef.current?.send()}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Expanded content — hidden by overflow when collapsed */}
      <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} />
    </div>
  )
}
