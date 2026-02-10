import { useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Plus, ArrowUp, Square, Clock, ArrowLeft, Loader2, GitBranch, Pencil } from 'lucide-react'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatMessage } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { SlashCommandOverlay } from './SlashCommandOverlay'
import { cn } from '@/lib/utils'
import type { SessionHistoryEntry } from '../../../../shared/agent-types'

const OFFSET = 16
const TITLEBAR_H = 44
const TOP_OFFSET = TITLEBAR_H + 8
const PANEL_W = 360
const COLLAPSED_H = 44
const DEFAULT_EXPANDED_H = 450
const MIN_EXPANDED_H = 250
const MAX_EXPANDED_H = 800

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
function cornerToXY(corner: Corner, panelH: number): { x: number; y: number } {
  const w = window.innerWidth
  const h = window.innerHeight
  return {
    x: corner.endsWith('l') ? OFFSET : w - PANEL_W - OFFSET,
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

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString()
}

function SessionHistory() {
  const sessions = useChatStore((s) => s.sessions)
  const resumeSession = useChatStore((s) => s.resumeSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const toggleHistory = useChatStore((s) => s.toggleHistory)
  const currentSessionId = useChatStore((s) => s.session?.sessionId)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  // ESC to close history (or cancel editing)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editingSessionId) {
          setEditingSessionId(null)
        } else {
          toggleHistory()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleHistory, editingSessionId])

  const handleResume = (entry: SessionHistoryEntry) => {
    if (editingSessionId) return
    if (entry.sessionId === currentSessionId) return
    resumeSession(entry.sessionId)
  }

  const startEditing = (entry: SessionHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(entry.sessionId)
    setEditingTitle(entry.title)
  }

  const confirmRename = () => {
    if (!editingSessionId) return
    const trimmed = editingTitle.trim()
    if (trimmed) {
      renameSession(editingSessionId, trimmed)
    }
    setEditingSessionId(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button size="icon-xs" variant="ghost" onClick={toggleHistory} className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-xs font-medium">History</span>
      </div>
      {sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No sessions found
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-0.5 p-2">
              {sessions.map((entry) => (
                <div
                  key={entry.sessionId}
                  onClick={() => handleResume(entry)}
                  className={cn(
                    'group rounded-md px-2.5 py-2 text-left transition-colors',
                    entry.sessionId === currentSessionId
                      ? 'bg-accent'
                      : 'cursor-pointer hover:bg-muted'
                  )}
                >
                  {editingSessionId === entry.sessionId ? (
                    <input
                      className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs font-medium outline-none focus:ring-1 focus:ring-ring"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingSessionId(null) }
                      }}
                      onBlur={confirmRename}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1 truncate text-xs font-medium">{entry.title}</div>
                      <button
                        onClick={(e) => startEditing(entry, e)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="size-3" />
                      </button>
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{formatRelativeTime(entry.lastActiveAt)}</span>
                    <span>{entry.messageCount} messages</span>
                    {entry.gitBranch && <span className="flex items-center gap-0.5 truncate"><GitBranch className="size-2.5" />{entry.gitBranch}</span>}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
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
  const showHistory = useChatStore((s) => s.showHistory)
  const toggleHistory = useChatStore((s) => s.toggleHistory)
  const hasMoreHistory = useChatStore((s) => s.hasMoreHistory)
  const isLoadingHistory = useChatStore((s) => s.isLoadingHistory)
  const loadMoreHistory = useChatStore((s) => s.loadMoreHistory)

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const compactInputRef = useRef<ChatInputHandle>(null)

  // Scroll position preservation for history prepend
  const prevScrollHeightRef = useRef<number>(0)
  const prevScrollTopRef = useRef<number>(0)
  const isPrependingRef = useRef(false)

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

  // Track whether user is near the bottom of the scroll area + trigger load-more
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const handleScroll = (): void => {
      const threshold = 40
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold

      // Trigger load-more when scrolled near top
      if (el.scrollTop < 500) {
        const { hasMoreHistory, isLoadingHistory } = useChatStore.getState()
        if (hasMoreHistory && !isLoadingHistory) {
          // Snapshot scroll position before prepend
          prevScrollHeightRef.current = el.scrollHeight
          prevScrollTopRef.current = el.scrollTop
          isPrependingRef.current = true
          loadMoreHistory()
        }
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [messages.length > 0, loadMoreHistory]) // re-attach when ScrollArea mounts/unmounts

  // Auto-scroll only when user was already near the bottom (sync before paint to avoid flash)
  // Also preserve scroll position after history prepend
  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return

    if (isPrependingRef.current) {
      // Restore scroll position after messages were prepended
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current
      el.scrollTop = prevScrollTopRef.current + heightDiff
      isPrependingRef.current = false
    } else if (isNearBottomRef.current) {
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
        'z-50 flex flex-col overflow-hidden border border-border shadow-2xl',
        !noTransition && 'transition-[top,right,bottom,left,height,border-radius] duration-200 ease-out'
      )}
    >
      {resizeHandle}

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
      <div className="relative flex min-h-0 flex-1 flex-col bg-card">
        {showHistory ? (
          <SessionHistory />
        ) : (
          <>
            <SlashCommandOverlay />
            <div className="flex-1 overflow-hidden">
              {messages.length === 0 ? (
                <ChatSuggestions />
              ) : (
                <ScrollArea className="h-full" viewportRef={scrollViewportRef}>
                  <div className="flex flex-col gap-1.5 p-3">
                    {isLoadingHistory && (
                      <div className="flex items-center justify-center py-2">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
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
          </>
        )}
      </div>
    </div>
  )
}
