import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type HoverTarget = { href: string; element: Element; point?: { clientX: number; clientY: number }; lineIndex?: number }

function hoveredLineIndex(element: Element, clientY: number) {
  let closestIndex = 0
  let closestDistance = Infinity
  Array.from(element.getClientRects()).forEach((line, index) => {
    const distance = Math.max(line.top - clientY, clientY - line.bottom, 0)
    if (distance < closestDistance) {
      closestIndex = index
      closestDistance = distance
    }
  })
  return closestIndex
}

/** Shared hover lifetime and cursor anchor for rendered links and editor decorations. */
export function useLinkPreviewHover() {
  const [target, setTarget] = useState<HoverTarget | null>(null)
  const [open, setOpen] = useState(false)
  const current = useRef<HoverTarget | null>(null)
  const isOpen = useRef(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const keepOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const close = useCallback(() => {
    keepOpen()
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = null
    current.current = null
    isOpen.current = false
    setOpen(false)
  }, [keepOpen])
  const scheduleClose = useCallback(() => {
    keepOpen()
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = null
    if (!isOpen.current) current.current = null
    closeTimer.current = setTimeout(close, 300)
  }, [close, keepOpen])

  const hover = useCallback((href: string, element: Element, point?: HoverTarget['point']) => {
    keepOpen()
    // Keep the initial anchor until this preview closes or its target/input changes.
    if (current.current?.href === href && current.current.element === element && !!current.current.point === !!point) return
    // Store numbers, never a React/native event that can outlive its dispatch.
    current.current = {
      href,
      element,
      point: point && { clientX: point.clientX, clientY: point.clientY },
      lineIndex: point ? hoveredLineIndex(element, point.clientY) : undefined,
    }
    if (isOpen.current) {
      setTarget(current.current)
    } else if (!openTimer.current) {
      openTimer.current = setTimeout(() => {
        openTimer.current = null
        setTarget(current.current)
        isOpen.current = true
        setOpen(true)
      }, 200)
    }
  }, [keepOpen])

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const anchor = useMemo(() => ({
    current: {
      contextElement: target?.element,
      getBoundingClientRect: () => {
        if (!target?.point) return target?.element.getBoundingClientRect() ?? new DOMRect()
        const line = target.element.getClientRects()[target.lineIndex ?? 0] ?? target.element.getBoundingClientRect()
        return new DOMRect(target.point.clientX, line.top, 0, line.height)
      },
    },
  }), [target])

  return { target, open, anchor, hover, keepOpen, close, scheduleClose }
}
