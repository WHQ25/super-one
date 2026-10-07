import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import './chat-scrollbar.css'

export interface ChatScrollbarHandle {
  hide(): void
}

/** Native WebView scrollbars also flash for scrollTo; reveal this one only after user input. */
export function ChatScrollbar({ ref }: { ref?: Ref<ChatScrollbarHandle> }) {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const manual = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef(0)
  const hide = useCallback(() => {
    manual.current = false
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    cancelAnimationFrame(frame.current)
    frame.current = 0
    if (track.current) track.current.dataset.visible = 'false'
  }, [])
  useImperativeHandle(ref, () => ({ hide }), [hide])

  useEffect(() => {
    const expire = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(hide, 650)
    }
    const arm = (event: Event) => {
      if (event.defaultPrevented || (event.target as Element | null)?.closest?.('.chat-scroll-indicator')) return
      manual.current = true
      // Input at an edge may produce no scroll event; it must not arm a later automatic scroll.
      expire()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey
        || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        || (event.target as Element | null)?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return
      arm(event)
    }
    const measure = () => {
      frame.current = 0
      if (!manual.current || !track.current || !thumb.current) return
      const height = track.current.clientHeight
      const scrollHeight = document.documentElement.scrollHeight
      const maxScroll = scrollHeight - window.innerHeight
      if (maxScroll <= 0 || height <= 0) { hide(); return }
      const thumbHeight = Math.min(height, Math.max(24, height * window.innerHeight / scrollHeight))
      const progress = Math.max(0, Math.min(1, window.scrollY / maxScroll))
      thumb.current.style.height = `${thumbHeight}px`
      thumb.current.style.transform = `translateY(${progress * (height - thumbHeight)}px)`
      track.current.dataset.visible = 'true'
    }
    const scroll = () => {
      if (!manual.current) return
      expire()
      if (!frame.current) frame.current = requestAnimationFrame(measure)
    }
    window.addEventListener('touchmove', arm, { passive: true })
    window.addEventListener('wheel', arm, { passive: true })
    window.addEventListener('keydown', keydown)
    window.addEventListener('scroll', scroll, { passive: true })
    return () => {
      window.removeEventListener('touchmove', arm)
      window.removeEventListener('wheel', arm)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('scroll', scroll)
      hide()
    }
  }, [hide])

  return <div ref={track} className="chat-scrollbar" data-visible="false" aria-hidden="true">
    <div ref={thumb} className="chat-scrollbar-thumb" />
  </div>
}
