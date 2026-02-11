import { useRef, useEffect, useLayoutEffect } from 'react'
import { useActiveSession } from '@/stores/chat'

interface UseChatScrollOptions {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
}

export function useChatScroll({ scrollViewportRef }: UseChatScrollOptions) {
  const messages = useActiveSession((s) => s.messages)

  const isNearBottomRef = useRef(true)

  // Track whether user is near the bottom of the scroll area
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const handleScroll = (): void => {
      const threshold = 40
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [messages.length > 0, scrollViewportRef])

  // Auto-scroll only when user was already near the bottom (sync before paint to avoid flash)
  useLayoutEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return

    const lastMsg = messages[messages.length - 1]
    if (isNearBottomRef.current || lastMsg?.role === 'user') {
      el.scrollTop = el.scrollHeight
      isNearBottomRef.current = true
    }
  }, [messages, scrollViewportRef])

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
  }, [messages.length > 0, scrollViewportRef])
}
