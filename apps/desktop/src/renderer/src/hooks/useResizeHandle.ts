import { useCallback, type RefObject } from 'react'

// Let the drag settle at its width limit before treating continued motion as a gesture.
const MAX_WIDTH_OVERSHOOT_PX = 16

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
  onResize?: (width: number) => void
  onDragEnd?: () => void
  onMaxWidthExceeded?: () => void
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
  onResize,
  onDragEnd,
  onMaxWidthExceeded,
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

    const applyWidth = (w: number) => {
      outer.style.width = `${w}px`
      inner.style.width = `${w}px`
      const linked = getLinkedPanel?.(w, prevW)
      if (linked) {
        linked.outer.style.transition = 'none'
        linked.outer.style.width = `${linked.width}px`
        linked.inner.style.width = `${linked.width}px`
      }
      prevW = w
      onResize?.(w)
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

    const finish = () => {
      cleanup()
      setWidth(prevW)
      onDragEnd?.()
    }

    const resize = (ev: MouseEvent, ending: boolean) => {
      const maxW = getMaxWidth()
      const delta = sign * (ev.clientX - startX)
      const requestedWidth = startW + delta
      applyWidth(Math.min(maxW, Math.max(minWidth, requestedWidth)))

      if (onMaxWidthExceeded && delta > 0 && requestedWidth >= maxW + MAX_WIDTH_OVERSHOOT_PX) {
        finish()
        onMaxWidthExceeded()
      } else if (ending) {
        finish()
      }
    }

    const onMove = (ev: MouseEvent) => resize(ev, false)
    const onUp = (ev: MouseEvent) => resize(ev, true)

    const onBlur = () => {
      applyWidth(prevW)
      finish()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
  }, [getWidth, setWidth, minWidth, getMaxWidth, direction, outerRef, innerRef, getLinkedPanel, onResize, onDragEnd, onMaxWidthExceeded])
}
