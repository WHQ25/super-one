import { useCallback, type RefObject } from 'react'

interface LinkedPanel {
  width: number
  outer: HTMLElement
  inner: HTMLElement
}

interface UseResizeHandleOptions {
  getWidth: () => number
  setWidth: (w: number) => void
  minWidth: number
  getMaxWidth: () => number
  direction: 'ltr' | 'rtl'
  outerRef: RefObject<HTMLDivElement | null>
  innerRef: RefObject<HTMLDivElement | null>
  getLinkedPanel?: (newWidth: number, prevWidth: number) => LinkedPanel | null
  onDragEnd?: () => void
}

export function useResizeHandle({
  getWidth,
  setWidth,
  minWidth,
  getMaxWidth,
  direction,
  outerRef,
  innerRef,
  getLinkedPanel,
  onDragEnd,
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

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize'
    document.body.appendChild(overlay)

    const sign = direction === 'ltr' ? 1 : -1
    let prevW = startW

    const calc = (clientX: number) => {
      const maxW = getMaxWidth()
      return Math.min(maxW, Math.max(minWidth, startW + sign * (clientX - startX)))
    }

    const onMove = (ev: MouseEvent) => {
      const w = calc(ev.clientX)
      outer.style.width = `${w}px`
      inner.style.width = `${w}px`
      const linked = getLinkedPanel?.(w, prevW)
      if (linked) {
        linked.outer.style.transition = 'none'
        linked.outer.style.width = `${linked.width}px`
        linked.inner.style.width = `${linked.width}px`
      }
      prevW = w
    }

    const cleanup = () => {
      outer.style.transition = ''
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      overlay.remove()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
    }

    const onUp = (ev: MouseEvent) => {
      const w = calc(ev.clientX)
      cleanup()
      setWidth(w)
      onDragEnd?.()
    }

    const onBlur = () => {
      cleanup()
      setWidth(prevW)
      onDragEnd?.()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
  }, [getWidth, setWidth, minWidth, getMaxWidth, direction, outerRef, innerRef, getLinkedPanel, onDragEnd])
}
