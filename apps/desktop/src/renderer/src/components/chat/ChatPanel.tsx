import { useRef, useCallback, useEffect, useState, useLayoutEffect, memo } from 'react'
import { motion, useMotionValue, animate } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useActiveSession, extractSessionTitle } from '@/stores/chat'
import { ChevronDown, Plus } from 'lucide-react'
import { ChatContent } from './ChatContent'
import { CollapsedChatPanelView, COLLAPSED_SIZE, COLLAPSED_PENDING_MAX_W } from './CollapsedChatPanelView'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'
import { getPendingReason } from '@/components/sidebar/session-state-utils'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { cn } from '@superone/ui/lib/utils'

const OFFSET = 8
const DEFAULT_PANEL_W = 360
const MIN_PANEL_W = 360
const MAX_PANEL_W = 800
const HEADER_H = 36
const DEFAULT_EXPANDED_H = 620
const MIN_EXPANDED_H = 580
const COLLAPSED_PENDING_PADDING = 54
const SIZE_ANIMATION_DURATION = 0.24
const SIZE_EASE = [0.32, 0.72, 0, 1] as const
const maxExpandedH = (availableHeight = window.innerHeight) => Math.floor(availableHeight * 0.9)

type Anchor = 'br' | 'bl' | 'tr' | 'tl' | 'tm' | 'rm' | 'bm' | 'lm'
export interface ChatPanelBounds { left: number; top: number; width: number; height: number }

/** Compute panel top-left position for a given anchor within the main workspace. */
export function anchorPosition(anchor: Anchor, panelW: number, panelH: number, bounds: ChatPanelBounds): { x: number; y: number } {
  const left = bounds.left + OFFSET
  const right = bounds.left + bounds.width - OFFSET - panelW
  const top = bounds.top + OFFSET
  const bottom = bounds.top + bounds.height - OFFSET - panelH
  switch (anchor) {
    case 'tl': return { x: left, y: top }
    case 'tr': return { x: right, y: top }
    case 'bl': return { x: left, y: bottom }
    case 'br': return { x: right, y: bottom }
    case 'tm': return { x: bounds.left + (bounds.width - panelW) / 2, y: top }
    case 'bm': return { x: bounds.left + (bounds.width - panelW) / 2, y: bottom }
    case 'lm': return { x: left, y: bounds.top + (bounds.height - panelH) / 2 }
    case 'rm': return { x: right, y: bounds.top + (bounds.height - panelH) / 2 }
  }
}

/** Pick nearest anchor by Euclidean distance from panel center to where panel center would sit at each anchor. */
export function nearestAnchor(panelCenterX: number, panelCenterY: number, panelW: number, panelH: number, bounds: ChatPanelBounds): Anchor {
  const halfW = panelW / 2
  const halfH = panelH / 2
  const targets: Array<[Anchor, number, number]> = [
    ['tl', bounds.left + OFFSET + halfW, bounds.top + OFFSET + halfH],
    ['tr', bounds.left + bounds.width - OFFSET - halfW, bounds.top + OFFSET + halfH],
    ['bl', bounds.left + OFFSET + halfW, bounds.top + bounds.height - OFFSET - halfH],
    ['br', bounds.left + bounds.width - OFFSET - halfW, bounds.top + bounds.height - OFFSET - halfH],
    ['tm', bounds.left + bounds.width / 2, bounds.top + OFFSET + halfH],
    ['bm', bounds.left + bounds.width / 2, bounds.top + bounds.height - OFFSET - halfH],
    ['lm', bounds.left + OFFSET + halfW, bounds.top + bounds.height / 2],
    ['rm', bounds.left + bounds.width - OFFSET - halfW, bounds.top + bounds.height / 2],
  ]
  let best: Anchor = 'br'
  let bestDist = Infinity
  for (const [anchor, ax, ay] of targets) {
    const dx = panelCenterX - ax
    const dy = panelCenterY - ay
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = anchor
    }
  }
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

type ResizeEdge = 'top' | 'bottom' | 'left' | 'right'

/** Insert a full-viewport transparent overlay so the cursor can't enter an underlying
 *  iframe (mini-app) during a drag/resize — iframes intercept mouse events and would
 *  break the window-level mousemove listener. */
function createDragCapture(cursor: string) {
  let el: HTMLDivElement | null = null
  return {
    acquire() {
      if (el) return
      el = document.createElement('div')
      el.style.cssText = `position:fixed;inset:0;z-index:2147483647;cursor:${cursor}`
      document.body.appendChild(el)
    },
    release() {
      if (!el) return
      el.remove()
      el = null
    },
  }
}

export const ChatPanel = memo(function ChatPanel({ anchorBoundaryRef }: { anchorBoundaryRef: React.RefObject<HTMLElement | null> }) {
  const { t } = useTranslation()
  const isOpen = useChatStore((s) => s.isOpen)
  const corner = useChatStore((s) => s.corner) as Anchor
  const setCorner = useChatStore((s) => s.setCorner)
  const toggleOpen = useChatStore((s) => s.toggleOpen)
  const sessionStatus = useActiveSession((s) => s.status)
  const sessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? '')
  const sessionFallback = useActiveSession((s) => s._title ?? extractSessionTitle(s.messages))
  const pendingPermissions = useActiveSession((s) => s.pendingPermissions)
  const pendingQuestion = useActiveSession((s) => s.pendingQuestion)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  const isUnseen = useChatStore((s) => {
    const proj = s.activeProject ? s.projectSessions[s.activeProject] : null
    if (!proj) return false
    const sid = proj._activeSessionId
    return sid ? proj.unseenCompletedSessions.has(sid) : false
  })
  const resetSession = useChatStore((s) => s.resetSession)

  const isRunning = sessionStatus === 'streaming' || sessionStatus === 'background'
  const pendingReason = getPendingReason(pendingPermissions, pendingQuestion, pendingPlanApproval, t)

  // Clear unseen flag when user opens panel
  useEffect(() => {
    if (!isOpen) return
    const state = useChatStore.getState()
    if (!state.activeProject) return
    const proj = state.projectSessions[state.activeProject]
    if (!proj?._activeSessionId) return
    if (!proj.unseenCompletedSessions.has(proj._activeSessionId)) return
    useChatStore.setState((s) => {
      const p = s.activeProject ? s.projectSessions[s.activeProject] : null
      if (!p?._activeSessionId) return {}
      const next = new Set(p.unseenCompletedSessions)
      next.delete(p._activeSessionId)
      return {
        projectSessions: {
          ...s.projectSessions,
          [s.activeProject!]: { ...p, unseenCompletedSessions: next },
        },
      }
    })
  }, [isOpen])

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)

  const { showScrollButton, scrollToBottom, stopAutoScroll } = useChatScroll({ scrollViewportRef })
  // CodingLayout remains mounted behind the maximized Activity workspace and owns
  // global chat shortcuts. Avoid registering a duplicate set for the floating view.
  useChatKeyboardShortcuts(false)

  // Panel dimensions
  const [expandedH, setExpandedH] = useState(() => Math.min(DEFAULT_EXPANDED_H, maxExpandedH()))
  const [panelW, setPanelW] = useState(DEFAULT_PANEL_W)

  // The floating chat belongs to the main workspace, not the full viewport. Observe
  // that card so sidebar transitions and window resizes both move the snap targets.
  const [anchorBounds, setAnchorBounds] = useState<ChatPanelBounds>(() => ({
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  useLayoutEffect(() => {
    const element = anchorBoundaryRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      setAnchorBounds(next)
      setExpandedH((height) => clamp(height, MIN_EXPANDED_H, maxExpandedH(next.height)))
      setPanelW((width) => clamp(width, MIN_PANEL_W, Math.min(MAX_PANEL_W, next.width - OFFSET * 2)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [anchorBoundaryRef])

  // Measure pending reason text natural width
  const [pendingTextW, setPendingTextW] = useState(0)
  useLayoutEffect(() => {
    if (!pendingReason) return
    const w = measureRef.current?.getBoundingClientRect().width ?? 0
    setPendingTextW(w)
  }, [pendingReason])

  const dragRef = useRef<{ dragging: boolean }>({ dragging: false })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  // Motion values for position — bypass React state so drag/resize don't trigger re-renders
  const mvX = useMotionValue(0)
  const mvY = useMotionValue(0)
  const positionAnimRef = useRef<{ stop: () => void } | null>(null)
  const hasInitPosRef = useRef(false)

  // Track when expansion animation finishes — controls when ChatContent fades in
  const [expansionComplete, setExpansionComplete] = useState(isOpen)
  useEffect(() => {
    if (!isOpen) setExpansionComplete(false)
  }, [isOpen])

  // Compute target dimensions
  const collapsedW = pendingReason
    ? Math.min(COLLAPSED_PENDING_PADDING + pendingTextW, COLLAPSED_PENDING_MAX_W)
    : COLLAPSED_SIZE
  const targetW = isOpen ? panelW : collapsedW
  const targetH = isOpen ? expandedH : COLLAPSED_SIZE
  const targetRadius = isOpen ? 16 : COLLAPSED_SIZE / 2

  // Sync motion-value position to anchor rest whenever anchor/size/window changes.
  // Skipped during drag/resize — those write to motion values directly.
  // isDragging is in deps (not just dragRef) so the snap-back animation runs
  // when the user releases — corner changes during drag, then isDragging flips false.
  useLayoutEffect(() => {
    if (isDragging || isResizing) return
    const rest = anchorPosition(corner, targetW, targetH, anchorBounds)
    positionAnimRef.current?.stop()
    if (!hasInitPosRef.current) {
      hasInitPosRef.current = true
      mvX.set(rest.x)
      mvY.set(rest.y)
      return
    }
    const ax = animate(mvX, rest.x, { duration: SIZE_ANIMATION_DURATION, ease: SIZE_EASE })
    const ay = animate(mvY, rest.y, { duration: SIZE_ANIMATION_DURATION, ease: SIZE_EASE })
    positionAnimRef.current = { stop: () => { ax.stop(); ay.stop() } }
  }, [corner, targetW, targetH, anchorBounds, isDragging, isResizing, mvX, mvY])

  // Which edges are anchored (cannot be resized) — affects which resize handles render
  const topAnchored = corner === 'tl' || corner === 'tr' || corner === 'tm'
  const bottomAnchored = corner === 'bl' || corner === 'br' || corner === 'bm'
  const leftAnchored = corner === 'tl' || corner === 'bl' || corner === 'lm'
  const rightAnchored = corner === 'tr' || corner === 'br' || corner === 'rm'

  // --- Drag handler (shared by header + collapsed icon) ---
  // Writes directly to motion values — no React re-render per frame.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      const startMouseX = e.clientX
      const startMouseY = e.clientY
      const startX = rect.left
      const startY = rect.top
      const w = rect.width
      const h = rect.height
      let dragging = false
      const capture = createDragCapture('grabbing')

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX
        const dy = ev.clientY - startMouseY
        if (!dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          dragging = true
          dragRef.current.dragging = true
          positionAnimRef.current?.stop()
          setIsDragging(true)
          capture.acquire()
        }
        if (dragging) {
          mvX.set(startX + dx)
          mvY.set(startY + dy)
        }
      }

      const handleUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        capture.release()
        if (dragging) {
          const cx = startX + (ev.clientX - startMouseX) + w / 2
          const cy = startY + (ev.clientY - startMouseY) + h / 2
          setCorner(nearestAnchor(cx, cy, w, h, anchorBounds))
        }
        setIsDragging(false)
        // dragRef stays true for one frame so the synthetic click after mouseup doesn't toggle
        requestAnimationFrame(() => {
          dragRef.current.dragging = false
        })
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [anchorBounds, setCorner, mvX, mvY]
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

  // --- Resize handler (one per edge) ---
  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      const startMouseX = e.clientX
      const startMouseY = e.clientY
      const startW = rect.width
      const startH = rect.height
      const startX = rect.left
      const startY = rect.top
      positionAnimRef.current?.stop()
      mvX.set(startX)
      mvY.set(startY)
      setIsResizing(true)
      const cursor = edge === 'top' || edge === 'bottom' ? 'ns-resize' : 'ew-resize'
      const capture = createDragCapture(cursor)
      capture.acquire()

      let raf = 0
      let nextW = startW
      let nextH = startH
      let nextX = startX
      let nextY = startY
      const flush = () => {
        raf = 0
        setPanelW(nextW)
        setExpandedH(nextH)
        mvX.set(nextX)
        mvY.set(nextY)
      }

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX
        const dy = ev.clientY - startMouseY
        switch (edge) {
          case 'top':
            nextH = clamp(startH - dy, MIN_EXPANDED_H, maxExpandedH(anchorBounds.height))
            nextY = startY + (startH - nextH)
            break
          case 'bottom':
            nextH = clamp(startH + dy, MIN_EXPANDED_H, maxExpandedH(anchorBounds.height))
            break
          case 'left':
            nextW = clamp(startW - dx, MIN_PANEL_W, Math.min(MAX_PANEL_W, anchorBounds.width - OFFSET * 2))
            nextX = startX + (startW - nextW)
            break
          case 'right':
            nextW = clamp(startW + dx, MIN_PANEL_W, Math.min(MAX_PANEL_W, anchorBounds.width - OFFSET * 2))
            break
        }
        if (raf === 0) raf = requestAnimationFrame(flush)
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        capture.release()
        cancelAnimationFrame(raf)
        setPanelW(nextW)
        setExpandedH(nextH)
        setIsResizing(false)
        // anchor-sync effect animates back to rest position
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [anchorBounds.height, anchorBounds.width, mvX, mvY]
  )

  const noTransitionForFreeze = isDragging || isResizing

  // Resize handles render — only when expanded; one per non-anchored edge
  const resizeHandles = isOpen && (
    <>
      {!topAnchored && (
        <div
          onMouseDown={handleResizeStart('top')}
          className="absolute left-0 right-0 top-0 z-10 h-1.5 cursor-ns-resize"
        />
      )}
      {!bottomAnchored && (
        <div
          onMouseDown={handleResizeStart('bottom')}
          className="absolute left-0 right-0 bottom-0 z-10 h-1.5 cursor-ns-resize"
        />
      )}
      {!leftAnchored && (
        <div
          onMouseDown={handleResizeStart('left')}
          className="absolute top-0 bottom-0 left-0 z-10 w-1.5 cursor-ew-resize"
        />
      )}
      {!rightAnchored && (
        <div
          onMouseDown={handleResizeStart('right')}
          className="absolute top-0 bottom-0 right-0 z-10 w-1.5 cursor-ew-resize"
        />
      )}
    </>
  )

  return (
    <>
      {/* Off-screen text measurement node */}
      {pendingReason && !isOpen && (
        <span
          ref={measureRef}
          aria-hidden
          className="invisible fixed -left-[9999px] -top-[9999px] whitespace-nowrap text-xs"
        >
          {pendingReason}
        </span>
      )}
      <motion.div
        ref={panelRef}
        style={{ position: 'fixed', top: 0, left: 0, x: mvX, y: mvY }}
        animate={{ width: targetW, height: targetH, borderRadius: targetRadius }}
        initial={{ width: targetW, height: targetH, borderRadius: targetRadius }}
        transition={noTransitionForFreeze
          ? { duration: 0 }
          : { duration: SIZE_ANIMATION_DURATION, ease: SIZE_EASE }}
        onAnimationComplete={() => {
          if (isOpen) setExpansionComplete(true)
        }}
        className={cn(
          'canvas-chat-panel @container z-50 flex flex-col overflow-hidden border border-border shadow-2xl',
          isResizing && 'will-change-[width,height]',
        )}
      >
        {resizeHandles}

        {isOpen ? (
          <div
            className={cn(
              'flex shrink-0 select-none items-center gap-2 bg-card px-3 pt-[2px]',
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
            style={{ height: HEADER_H }}
            onMouseDown={handleMouseDown}
          >
            <button
              onClick={handleToggle}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <SessionTitleAnimated
              sessionId={sessionId}
              fallback={sessionFallback ?? 'New Session'}
              className="min-w-0 flex-1 pr-3 text-xs text-muted-foreground"
            />
            <button
              onClick={() => resetSession()}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        ) : (
          <CollapsedChatPanelView
            pendingReason={pendingReason}
            isRunning={isRunning}
            isUnseen={isUnseen}
            isDragging={isDragging}
            onClick={handleToggle}
            onMouseDown={handleMouseDown}
          />
        )}

        <motion.div
          className="@container relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card"
          animate={{ opacity: isOpen && expansionComplete ? 1 : 0 }}
          initial={{ opacity: isOpen ? 1 : 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
          <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} stopAutoScroll={stopAutoScroll} />
        </motion.div>
      </motion.div>
    </>
  )
})
