import { useCallback, type RefObject } from 'react'

interface UseResizeHandleOptions {
  getWidth: () => number
  setWidth: (w: number) => void
  minWidth: number
  getMaxWidth: () => number
  direction: 'ltr' | 'rtl'
  outerRef: RefObject<HTMLDivElement | null>
  innerRef: RefObject<HTMLDivElement | null>
}

export function useResizeHandle({
  getWidth,
  setWidth,
  minWidth,
  getMaxWidth,
  direction,
  outerRef,
  innerRef,
}: UseResizeHandleOptions) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = getWidth()
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    outer.style.transition = 'none'
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const sign = direction === 'ltr' ? 1 : -1

    const calc = (clientX: number) => {
      const maxW = getMaxWidth()
      return Math.min(maxW, Math.max(minWidth, startW + sign * (clientX - startX)))
    }

    const onMove = (ev: MouseEvent) => {
      const w = calc(ev.clientX)
      outer.style.width = `${w}px`
      inner.style.width = `${w}px`
    }

    const onUp = (ev: MouseEvent) => {
      const w = calc(ev.clientX)
      outer.style.transition = ''
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth(w)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [getWidth, setWidth, minWidth, getMaxWidth, direction, outerRef, innerRef])
}
