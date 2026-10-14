import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { useActiveSession, useSessionScope } from '@/stores/chat'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'

interface UseChatScrollOptions {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
}

interface UseChatScrollReturn {
  showScrollButton: boolean
  scrollToBottom: () => void
  stopAutoScroll: () => void
}

const RESUME_AT_BOTTOM_PX = 24

function isPauseFollowWheel(event: WheelEvent): boolean {
  if (event.deltaY >= 0) return false
  // Horizontal pans on overflow-x blocks often carry a tiny deltaY. Axis
  // dominance keeps follow on; any real vertical-up still pauses, including
  // slow trackpad ticks of 1–5px.
  return Math.abs(event.deltaX) < Math.abs(event.deltaY)
}

/**
 * `scrollHeight` / `clientHeight` are rounded to integers while `scrollTop` keeps
 * sub-pixels, so the max scroll offset derived from them can be off by up to 1px
 * in either direction. Fractional layouts are the norm here because responsive
 * chat sizing and non-integer DPRs both produce sub-pixels. Without this slack,
 * the guard below could never hold on a viewport whose metrics rounded up,
 * silently degrading the dedup back to "write on every frame". This 1px slack is
 * far tighter than the 24px band `RESUME_AT_BOTTOM_PX` already treats as "at the
 * bottom".
 */
const AT_BOTTOM_EPSILON_PX = 1

/**
 * Pin the viewport to the follow line, skipping the write when it is already there
 * (or below it, revealing what a taller composer covers).
 *
 * A redundant `scrollTop` write is not free. It fires a `scroll` event, and each
 * of those cascades into `handleScroll` plus ChatScrollIndicator's rAF +
 * `getBoundingClientRect` — every one of them a forced synchronous layout over
 * the full message list.
 *
 * That matters because during streaming *two* paths pin on the same frame: the
 * `messages` layout effect (content changed) and the ResizeObserver (height
 * changed — caused by the very same content change). Whichever runs second
 * lands on a viewport that is already at the bottom, so its write moves nothing
 * and buys nothing. Guarding here keeps both paths intact — the ResizeObserver
 * still catches late growth like image decode or font swap, where the layout
 * effect never runs because `messages` did not change.
 */
function pinToBottom(el: HTMLElement, revealed: boolean): void {
  const top = followTop(el, revealed)
  if (el.scrollTop >= top - AT_BOTTOM_EPSILON_PX) return
  el.scrollTop = top
}

/** How far a taller composer standing in rises above the text composer's resting top (ChatContent publishes it). */
function composerOverhang(el: HTMLElement): number {
  const overhang = parseFloat(el.closest<HTMLElement>('[data-chat-root]')?.style.getPropertyValue('--composer-overhang') ?? '')
  return Math.max(0, overhang || 0)
}

/**
 * The scroll offset that puts the transcript's end on the text composer's
 * resting top edge. A taller composer standing in (a decision, a form) covers
 * the tail instead of moving history. Scrolling past this line reveals it, and
 * following then keeps the true end in view until the composer leaves.
 */
function followTop(el: HTMLElement, revealed: boolean): number {
  return el.scrollHeight - el.clientHeight - (revealed ? 0 : composerOverhang(el))
}

const followByViewport = new WeakMap<HTMLElement, () => boolean>()

/**
 * Whether growth in this viewport should keep the tail in place, or `undefined`
 * without a useChatScroll host. The virtual transcript anchors to the end only
 * while this holds; it never decides following from geometry itself.
 */
export function isFollowingTail(viewport: HTMLElement): boolean | undefined {
  return followByViewport.get(viewport)?.()
}

export function useChatScroll({ scrollViewportRef }: UseChatScrollOptions): UseChatScrollReturn {
  const scope = useSessionScope()
  const messages = useActiveSession((s) => s.messages)
  const activeSessionId = useActiveSession((s) => s._activeSessionId)
  const sessionId = scope?.sessionId ?? activeSessionId
  const provider = useActiveSession((s) => resolveProvider(s))
  const realtime = useCodexRealtimeViewStore((s) => sessionId
    ? s.sessions[sessionId] ?? EMPTY_CODEX_REALTIME_SESSION_VIEW
    : EMPTY_CODEX_REALTIME_SESSION_VIEW)
  const showRealtime = provider === 'codex' && realtime.hasTimeline && realtime.view === 'realtime'
  // The two views mount different viewports, even within the same session.
  const viewKey = showRealtime ? 'realtime' : 'thread'
  const sessionKey = scope ? `${scope.projectPath}\0${scope.sessionId}` : activeSessionId
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)

  // Explicit upward input pauses following. It resumes only when the user moves
  // back toward the bottom, or a deliberate tick jump lands there.
  const followRef = useRef(true)
  const pausedScrollTopRef = useRef(0)
  // Scrolled past the follow line while a taller composer covers the tail.
  const revealedRef = useRef(false)
  // Space held below the content when the viewport grew at the end, so history
  // stays put and new content appends into it.
  const reserveRef = useRef(0)
  const clientHeightRef = useRef(0)
  const rootHeightRef = useRef(0)
  const allowStationaryBottomResumeRef = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const sessionSwitchRef = useRef(false)
  const sessionSwitchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const SETTLE_TIMEOUT = 300

  /**
   * A viewport growing at the end (a taller composer leaving, the text composer
   * shrinking) makes the browser clamp scrollTop and drop history by the growth.
   * Hold that much as bottom padding and restore the offset instead. Only growth
   * inside the chat root counts: a resized window or a closed terminal panel
   * changes the root itself, and the tail stays at the bottom then. The reserve
   * only shrinks afterwards: new content fills it, and scrolling up releases
   * what is no longer on screen. The clamp's scroll event can arrive before or
   * after the resize callback, so both run this before recording the offset.
   */
  const settleTail = useCallback((el: HTMLElement) => {
    if (composerOverhang(el) === 0) revealedRef.current = false
    const grew = el.clientHeight - clientHeightRef.current
    clientHeightRef.current = el.clientHeight
    const rootHeight = el.closest('[data-chat-root]')?.clientHeight ?? 0
    const external = rootHeight !== rootHeightRef.current
    rootHeightRef.current = rootHeight
    // A clamp leaves scrollTop at the new maximum. Elsewhere a lower offset is a
    // row re-measuring or the user, and the last recorded offset may be stale.
    const clamped = el.scrollTop >= el.scrollHeight - el.clientHeight - AT_BOTTOM_EPSILON_PX
    const dropped = pausedScrollTopRef.current - el.scrollTop
    let reserve = reserveRef.current
    // Growth comes in whole pixels as the slot eases down; only sub-pixel noise is ignored.
    if (grew > 0 && clamped && dropped > 0.5 && !external) reserve += Math.min(grew, dropped)
    else if (reserve > 0) {
      // How much of the reserve is on screen. Heights are whole pixels while the
      // clamped offset is fractional, so this reads up to a pixel short at the
      // end; shrinking by that would clamp a pixel and repeat every frame.
      const shown = el.scrollTop + el.clientHeight - (el.scrollHeight - reserve)
      reserve = shown <= AT_BOTTOM_EPSILON_PX ? 0 : Math.min(reserve, shown + AT_BOTTOM_EPSILON_PX)
    }
    if (reserve === reserveRef.current) return
    const held = reserve - reserveRef.current
    reserveRef.current = reserve
    el.style.paddingBottom = reserve > 0 ? `${reserve}px` : ''
    if (held > 0) el.scrollTop += held
  }, [])

  const followTail = useCallback((el: HTMLElement) => {
    settleTail(el)
    pinToBottom(el, revealedRef.current)
  }, [settleTail])

  useLayoutEffect(() => {
    followRef.current = true
    allowStationaryBottomResumeRef.current = false
    sessionSwitchRef.current = true
    revealedRef.current = false
    setShowScrollButton(false)
    clearTimeout(sessionSwitchTimerRef.current)
    const el = scrollViewportRef.current
    if (el) {
      reserveRef.current = 0
      el.style.paddingBottom = ''
      clientHeightRef.current = el.clientHeight
      rootHeightRef.current = el.closest('[data-chat-root]')?.clientHeight ?? 0
      pinToBottom(el, false)
      pausedScrollTopRef.current = el.scrollTop
      if (import.meta.env.DEV) {
        window.app.trace?.('scroll', 'session_switch', { sessionId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight, msgCount: messages.length })
      }
    }
  }, [sessionKey, viewKey, scrollViewportRef])

  const prevPlanApprovalRef = useRef(pendingPlanApproval)
  useLayoutEffect(() => {
    const wasPending = prevPlanApprovalRef.current
    prevPlanApprovalRef.current = pendingPlanApproval
    if (wasPending && !pendingPlanApproval) {
      followRef.current = true
      allowStationaryBottomResumeRef.current = false
      sessionSwitchRef.current = true
      setShowScrollButton(false)
      clearTimeout(sessionSwitchTimerRef.current)
      sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
    }
  }, [pendingPlanApproval])

  const viewportMounted = !pendingPlanApproval && (showRealtime || messages.length > 0)

  const pauseAutoScroll = useCallback((allowStationaryBottomResume: boolean) => {
    const el = scrollViewportRef.current
    if (el && el.scrollHeight <= el.clientHeight) return
    followRef.current = false
    revealedRef.current = false
    pausedScrollTopRef.current = el?.scrollTop ?? 0
    allowStationaryBottomResumeRef.current = allowStationaryBottomResume
    sessionSwitchRef.current = false
    clearTimeout(sessionSwitchTimerRef.current)
    setShowScrollButton(true)
  }, [scrollViewportRef])

  const stopAutoScroll = useCallback(() => {
    pauseAutoScroll(true)
  }, [pauseAutoScroll])

  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const view = el.ownerDocument.defaultView ?? window
    let pointerDown = false
    let touchY = 0
    const handleWheel = (e: WheelEvent): void => {
      if (isPauseFollowWheel(e)) pauseAutoScroll(false)
    }
    const handleTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const handleTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? 0
      if (y > touchY) pauseAutoScroll(false)
      touchY = y
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') pauseAutoScroll(false)
    }
    const handlePointerDown = (): void => { pointerDown = true }
    const handlePointerUp = (): void => { pointerDown = false }
    const handleScroll = (): void => {
      settleTail(el)
      if (followRef.current && el.scrollTop > followTop(el, false) + AT_BOTTOM_EPSILON_PX) revealedRef.current = true
      const remaining = followTop(el, revealedRef.current) - el.scrollTop
      if (followRef.current) {
        // A drag that scrolls (text selection, middle-click autoscroll) fires
        // only scroll events. Without a pressed pointer a decrease is layout: the
        // browser clamping after rows shrank, whose event can land after they
        // grew again. Jumps pause through stopAutoScroll; the bar is hidden.
        const movedUp = el.scrollTop < pausedScrollTopRef.current - 1
        pausedScrollTopRef.current = el.scrollTop
        if (pointerDown && movedUp && remaining > RESUME_AT_BOTTOM_PX) pauseAutoScroll(false)
      } else {
        const movedTowardBottom = el.scrollTop > pausedScrollTopRef.current + 1
        pausedScrollTopRef.current = el.scrollTop
        if ((movedTowardBottom || allowStationaryBottomResumeRef.current) && remaining <= RESUME_AT_BOTTOM_PX) {
          followRef.current = true
        }
        allowStationaryBottomResumeRef.current = false
      }
      setShowScrollButton(!followRef.current)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    el.addEventListener('wheel', handleWheel, { passive: true })
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('keydown', handleKeyDown)
    el.addEventListener('pointerdown', handlePointerDown)
    view.addEventListener('pointerup', handlePointerUp, true)
    view.addEventListener('pointercancel', handlePointerUp, true)
    const following = (): boolean => followRef.current && reserveRef.current === 0
    followByViewport.set(el, following)
    return () => {
      if (followByViewport.get(el) === following) followByViewport.delete(el)
      el.removeEventListener('pointerdown', handlePointerDown)
      view.removeEventListener('pointerup', handlePointerUp, true)
      view.removeEventListener('pointercancel', handlePointerUp, true)
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [sessionKey, viewKey, viewportMounted, scrollViewportRef, pauseAutoScroll, settleTail])

  const lastMsgIsUser = !showRealtime && messages.length > 0 && messages[messages.length - 1].role === 'user'

  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const shouldScroll = followRef.current || lastMsgIsUser
    // DEV-only: `messages` churns on every streaming delta, so this effect runs
    // ~30x/s. Reading scrollHeight from a layout effect forces a synchronous
    // full-list reflow — O(messages) — and it would run even when we are not
    // scrolling. `?.` alone does not save us: preload always defines `trace`,
    // so the argument object (and its layout reads) would still be evaluated.
    if (import.meta.env.DEV) {
      window.app.trace?.('scroll', 'msg_change', { msgLen: messages.length, shouldScroll, follow: followRef.current, lastMsgIsUser, sessionSwitch: sessionSwitchRef.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight })
    }
    if (shouldScroll) {
      followTail(el)
      pausedScrollTopRef.current = el.scrollTop
      followRef.current = true
      allowStationaryBottomResumeRef.current = false
      setShowScrollButton(false)
    }
  }, [messages, showRealtime ? realtime : null, viewKey, lastMsgIsUser, scrollViewportRef, followTail])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const content = viewport.firstElementChild as HTMLElement | null
    if (!content) return
    if (sessionSwitchRef.current && followRef.current) {
      followTail(viewport)
      pausedScrollTopRef.current = viewport.scrollTop
      setShowScrollButton(false)
    }
    const observer = new ResizeObserver(() => {
      // Late growth (syntax highlight, wrap, content-visibility revealing a
      // tall tool block) often lands after the turn is already idle. Follow
      // state, not streaming, is what decides whether to stay pinned.
      if (followRef.current) {
        followTail(viewport)
        pausedScrollTopRef.current = viewport.scrollTop
        setShowScrollButton(false)
      } else {
        settleTail(viewport)
      }
      if (sessionSwitchRef.current) {
        clearTimeout(sessionSwitchTimerRef.current)
        sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
      }
    })
    observer.observe(content)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [sessionKey, viewKey, viewportMounted, scrollViewportRef, followTail, settleTail])

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      pausedScrollTopRef.current = el.scrollTop
      followRef.current = true
      allowStationaryBottomResumeRef.current = false
      sessionSwitchRef.current = false
      clearTimeout(sessionSwitchTimerRef.current)
      setShowScrollButton(false)
    }
  }, [scrollViewportRef])

  return { showScrollButton, scrollToBottom, stopAutoScroll }
}
