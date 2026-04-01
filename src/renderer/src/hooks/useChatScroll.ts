import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { useActiveSession } from '@/stores/chat'

interface UseChatScrollOptions {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
}

interface UseChatScrollReturn {
  showScrollButton: boolean
  scrollToBottom: () => void
}

export function useChatScroll({ scrollViewportRef }: UseChatScrollOptions): UseChatScrollReturn {
  const messages = useActiveSession((s) => s.messages)
  const sessionId = useActiveSession((s) => s._activeSessionId)
  const status = useActiveSession((s) => s.status)
  const statusRef = useRef(status)
  statusRef.current = status

  const isNearBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const userScrollTimeRef = useRef(0)
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

  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const markUserScroll = (): void => { userScrollTimeRef.current = Date.now() }
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      const scrolledUp = el.scrollTop < lastScrollTopRef.current
      lastScrollTopRef.current = el.scrollTop

      const isUserScroll = Date.now() - userScrollTimeRef.current < 150
      if (isUserScroll) {
        if (scrolledUp && statusRef.current === 'streaming') {
          isNearBottomRef.current = remaining < 200
        } else {
          isNearBottomRef.current = remaining < el.clientHeight / 2
        }
      }
      setShowScrollButton(remaining > el.clientHeight)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    el.addEventListener('wheel', markUserScroll, { passive: true })
    el.addEventListener('pointerdown', markUserScroll)
    return () => {
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('wheel', markUserScroll)
      el.removeEventListener('pointerdown', markUserScroll)
    }
  }, [sessionId, messages.length > 0, scrollViewportRef])

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
    let rafId = 0
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && (statusRef.current === 'streaming' || sessionSwitchRef.current)) {
        viewport.scrollTop = viewport.scrollHeight
        lastScrollTopRef.current = viewport.scrollTop
        setShowScrollButton(false)
        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          if (isNearBottomRef.current) {
            viewport.scrollTop = viewport.scrollHeight
            lastScrollTopRef.current = viewport.scrollTop
          }
        })
      }
      if (sessionSwitchRef.current) {
        clearTimeout(sessionSwitchTimerRef.current)
        sessionSwitchTimerRef.current = setTimeout(() => { sessionSwitchRef.current = false }, SETTLE_TIMEOUT)
      }
    })
    observer.observe(content)
    observer.observe(viewport)
    return () => { observer.disconnect(); cancelAnimationFrame(rafId) }
  }, [sessionId, messages.length > 0, scrollViewportRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      isNearBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [scrollViewportRef])

  return { showScrollButton, scrollToBottom }
}
