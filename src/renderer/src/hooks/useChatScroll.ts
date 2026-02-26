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

  const isNearBottomRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  useLayoutEffect(() => {
    isNearBottomRef.current = true
    setShowScrollButton(false)
    const el = scrollViewportRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId])

  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const handleScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      isNearBottomRef.current = remaining < el.clientHeight / 2
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
      isNearBottomRef.current = true
      setShowScrollButton(false)
    }
  }, [messages, scrollViewportRef])

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
