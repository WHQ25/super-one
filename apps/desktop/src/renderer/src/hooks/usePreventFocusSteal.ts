import { useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

const FOCUS_TRIGGERING = 'button, [role="button"]'

export const preventFocusSteal = (e: ReactMouseEvent) => {
  if (e.button === 0) e.preventDefault()
}

export function usePreventFocusSteal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest(FOCUS_TRIGGERING)) e.preventDefault()
    }
    el.addEventListener('mousedown', onMouseDown)
    return () => el.removeEventListener('mousedown', onMouseDown)
  }, [])
  return ref
}
