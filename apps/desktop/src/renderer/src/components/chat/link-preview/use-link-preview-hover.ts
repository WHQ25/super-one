import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type HoverTarget = { href: string; element: Element; point?: { clientX: number; clientY: number } }

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
    closeTimer.current = setTimeout(close, 300)
  }, [close, keepOpen])

  const hover = useCallback((href: string, element: Element, point?: HoverTarget['point']) => {
    keepOpen()
    // Store numbers, never a React/native event that can outlive its dispatch.
    current.current = { href, element, point: point && { clientX: point.clientX, clientY: point.clientY } }
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
      getBoundingClientRect: () => target?.point
        ? new DOMRect(target.point.clientX, target.point.clientY, 0, 0)
        : target?.element.getBoundingClientRect() ?? new DOMRect(),
    },
  }), [target])

  return { target, open, anchor, hover, keepOpen, close, scheduleClose }
}
