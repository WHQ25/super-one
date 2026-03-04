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
  const [showScrollButton, setShowScrollButton] = useState(false)

  useLayoutEffect(() => {
    isNearBottomRef.current = true
    setShowScrollButton(false)
    const el = scrollViewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      lastScrollTopRef.current = el.scrollTop
    }
  }, [sessionId])

  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      const scrolledUp = el.scrollTop < lastScrollTopRef.current
      lastScrollTopRef.current = el.scrollTop

      if (scrolledUp && statusRef.current === 'streaming') {
        isNearBottomRef.current = false
      } else {
        isNearBottomRef.current = remaining < el.clientHeight / 2
      }
      setShowScrollButton(remaining > el.clientHeight)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [sessionId, messages.length > 0, scrollViewportRef])

  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return

    const lastMsg = messages[messages.length - 1]
    if (isNearBottomRef.current || lastMsg?.role === 'user') {
      el.scrollTop = el.scrollHeight
      lastScrollTopRef.current = el.scrollTop
      isNearBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [messages, scrollViewportRef])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const content = viewport.firstElementChild as HTMLElement | null
    if (!content) return
    let rafId = 0
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && statusRef.current === 'streaming') {
        viewport.scrollTop = viewport.scrollHeight
        lastScrollTopRef.current = viewport.scrollTop
        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          if (isNearBottomRef.current) {
            viewport.scrollTop = viewport.scrollHeight
            lastScrollTopRef.current = viewport.scrollTop
          }
        })
      }
    })
    observer.observe(content)
    return () => { observer.disconnect(); cancelAnimationFrame(rafId) }
  }, [sessionId, messages.length > 0, scrollViewportRef])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let rafId = 0
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && statusRef.current === 'streaming') {
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
    })
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
