import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { useActiveSession, useSessionScope } from '@/stores/chat'

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
  const scope = useSessionScope()
  const messages = useActiveSession((s) => s.messages)
  const activeSessionId = useActiveSession((s) => s._activeSessionId)
  const sessionId = scope?.sessionId ?? activeSessionId
  const sessionKey = scope ? `${scope.projectPath}\0${scope.sessionId}` : activeSessionId
  const status = useActiveSession((s) => s.status)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  const statusRef = useRef(status)
  statusRef.current = status

  // Explicit upward input pauses following. It resumes only when the user moves
  // back toward the bottom, or a deliberate tick jump lands there.
  const followRef = useRef(true)
  const pausedScrollTopRef = useRef(0)
  const allowStationaryBottomResumeRef = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const sessionSwitchRef = useRef(false)
  const sessionSwitchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const SETTLE_TIMEOUT = 300

  useLayoutEffect(() => {
    followRef.current = true
    allowStationaryBottomResumeRef.current = false
    sessionSwitchRef.current = true
    setShowScrollButton(false)
    clearTimeout(sessionSwitchTimerRef.current)
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      window.app.trace?.('scroll', 'session_switch', { sessionId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight, msgCount: messages.length })
    }
  }, [sessionKey, scrollViewportRef])

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

  const viewportMounted = !pendingPlanApproval && messages.length > 0

  const pauseAutoScroll = useCallback((allowStationaryBottomResume: boolean) => {
    const el = scrollViewportRef.current
    if (el && el.scrollHeight <= el.clientHeight) return
    followRef.current = false
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
    let touchY = 0
    const handleWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) pauseAutoScroll(false)
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
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (!followRef.current) {
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
    return () => {
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [sessionKey, viewportMounted, scrollViewportRef, pauseAutoScroll])

  const lastMsgIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user'

  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const shouldScroll = followRef.current || lastMsgIsUser
    window.app.trace?.('scroll', 'msg_change', { msgLen: messages.length, shouldScroll, follow: followRef.current, lastMsgIsUser, sessionSwitch: sessionSwitchRef.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight })
    if (shouldScroll) {
      el.scrollTop = el.scrollHeight
      followRef.current = true
      allowStationaryBottomResumeRef.current = false
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
  }, [sessionKey, viewportMounted, scrollViewportRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      followRef.current = true
      allowStationaryBottomResumeRef.current = false
      sessionSwitchRef.current = false
      clearTimeout(sessionSwitchTimerRef.current)
      setShowScrollButton(false)
    }
  }, [scrollViewportRef])

  return { showScrollButton, scrollToBottom, stopAutoScroll }
}
