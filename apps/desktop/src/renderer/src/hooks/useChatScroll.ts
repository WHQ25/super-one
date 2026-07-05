import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { useActiveSession } from '@/stores/chat'

interface UseChatScrollOptions {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
}

interface UseChatScrollReturn {
  showScrollButton: boolean
  scrollToBottom: () => void
  stopAutoScroll: () => void
}

const RESUME_AT_BOTTOM_PX = 24

export function useChatScroll({ scrollViewportRef }: UseChatScrollOptions): UseChatScrollReturn {
  const messages = useActiveSession((s) => s.messages)
  const sessionId = useActiveSession((s) => s._activeSessionId)
  const status = useActiveSession((s) => s.status)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  const statusRef = useRef(status)
  statusRef.current = status

  // Intent state machine. Follow is broken ONLY by user input events (wheel up,
  // touch drag, key up, stopAutoScroll) — never by scroll events, which cannot
  // distinguish user scrolls from programmatic pins or browser clamping.
  // While following is false the hook performs no programmatic scrolls, so every
  // scroll event in that window is user-driven and reaching the bottom band is an
  // unambiguous resume signal.
  const followRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const sessionSwitchRef = useRef(false)
  const sessionSwitchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const SETTLE_TIMEOUT = 300

  useLayoutEffect(() => {
    followRef.current = true
    sessionSwitchRef.current = true
    setShowScrollButton(false)
    clearTimeout(sessionSwitchTimerRef.current)
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      window.app.trace?.('scroll', 'session_switch', { sessionId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight, msgCount: messages.length })
    }
  }, [sessionId, scrollViewportRef])

  const prevPlanApprovalRef = useRef(pendingPlanApproval)
  useLayoutEffect(() => {
    const wasPending = prevPlanApprovalRef.current
    prevPlanApprovalRef.current = pendingPlanApproval
    if (wasPending && !pendingPlanApproval) {
      followRef.current = true
      sessionSwitchRef.current = true
      setShowScrollButton(false)
      clearTimeout(sessionSwitchTimerRef.current)
      sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
    }
  }, [pendingPlanApproval])

  const viewportMounted = !pendingPlanApproval && messages.length > 0

  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const breakFollow = (): void => {
      if (el.scrollHeight > el.clientHeight) followRef.current = false
    }
    let touchY = 0
    const handleWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) breakFollow()
    }
    const handleTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const handleTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? 0
      if (y > touchY) breakFollow()
      touchY = y
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') breakFollow()
    }
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (!followRef.current && remaining <= RESUME_AT_BOTTOM_PX) {
        followRef.current = true
      }
      setShowScrollButton(remaining > el.clientHeight)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    el.addEventListener('wheel', handleWheel, { passive: true })
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [sessionId, viewportMounted, scrollViewportRef])

  const lastMsgIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user'

  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const shouldScroll = followRef.current || lastMsgIsUser || sessionSwitchRef.current
    window.app.trace?.('scroll', 'msg_change', { msgLen: messages.length, shouldScroll, follow: followRef.current, lastMsgIsUser, sessionSwitch: sessionSwitchRef.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight })
    if (shouldScroll) {
      el.scrollTop = el.scrollHeight
      followRef.current = true
      setShowScrollButton(false)
    }
  }, [messages, lastMsgIsUser, scrollViewportRef])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const content = viewport.firstElementChild as HTMLElement | null
    if (!content) return
    if (sessionSwitchRef.current && followRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      setShowScrollButton(false)
    }
    const observer = new ResizeObserver(() => {
      if (followRef.current && (statusRef.current === 'streaming' || sessionSwitchRef.current)) {
        viewport.scrollTop = viewport.scrollHeight
        setShowScrollButton(false)
      }
      if (sessionSwitchRef.current) {
        clearTimeout(sessionSwitchTimerRef.current)
        sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
      }
    })
    observer.observe(content)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [sessionId, viewportMounted, scrollViewportRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      followRef.current = true
      setShowScrollButton(false)
    }
  }, [scrollViewportRef])

  const stopAutoScroll = useCallback(() => {
    followRef.current = false
    setShowScrollButton(true)
  }, [])

  return { showScrollButton, scrollToBottom, stopAutoScroll }
}
