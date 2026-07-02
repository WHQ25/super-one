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

  const isNearBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const sessionSwitchRef = useRef(false)
  const sessionSwitchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const SETTLE_TIMEOUT = 300

  useLayoutEffect(() => {
    isNearBottomRef.current = true
    sessionSwitchRef.current = true
    setShowScrollButton(false)
    clearTimeout(sessionSwitchTimerRef.current)
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      lastScrollTopRef.current = el.scrollTop
      window.app.trace?.('scroll', 'session_switch', { sessionId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight, msgCount: messages.length })
    }
  }, [sessionId, scrollViewportRef])

  const prevPlanApprovalRef = useRef(pendingPlanApproval)
  useLayoutEffect(() => {
    const wasPending = prevPlanApprovalRef.current
    prevPlanApprovalRef.current = pendingPlanApproval
    if (wasPending && !pendingPlanApproval) {
      isNearBottomRef.current = true
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
    const handleWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) isNearBottomRef.current = false
    }
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      const scrolledUp = el.scrollTop < lastScrollTopRef.current - 1
      lastScrollTopRef.current = el.scrollTop

      if (scrolledUp) {
        isNearBottomRef.current = false
      } else if (remaining <= RESUME_AT_BOTTOM_PX) {
        isNearBottomRef.current = true
      }
      setShowScrollButton(remaining > el.clientHeight)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    el.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [sessionId, viewportMounted, scrollViewportRef])

  const lastMsgIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user'

  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const shouldScroll = isNearBottomRef.current || lastMsgIsUser || sessionSwitchRef.current
    window.app.trace?.('scroll', 'msg_change', { msgLen: messages.length, shouldScroll, isNearBottom: isNearBottomRef.current, lastMsgIsUser, sessionSwitch: sessionSwitchRef.current, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight })
    if (shouldScroll) {
      el.scrollTop = el.scrollHeight
      lastScrollTopRef.current = el.scrollTop
      isNearBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [messages, lastMsgIsUser, scrollViewportRef])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const content = viewport.firstElementChild as HTMLElement | null
    if (!content) return
    if (sessionSwitchRef.current && isNearBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      lastScrollTopRef.current = viewport.scrollTop
      setShowScrollButton(false)
    }
    let rafId = 0
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && (statusRef.current === 'streaming' || sessionSwitchRef.current)) {
        viewport.scrollTop = viewport.scrollHeight
        lastScrollTopRef.current = viewport.scrollTop
        setShowScrollButton(false)
      }
      if (sessionSwitchRef.current) {
        clearTimeout(sessionSwitchTimerRef.current)
        sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
      }
    })
    observer.observe(content)
    observer.observe(viewport)
    return () => { observer.disconnect(); cancelAnimationFrame(rafId) }
  }, [sessionId, viewportMounted, scrollViewportRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      isNearBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [scrollViewportRef])

  const stopAutoScroll = useCallback(() => {
    isNearBottomRef.current = false
    setShowScrollButton(true)
  }, [])

  return { showScrollButton, scrollToBottom, stopAutoScroll }
}
