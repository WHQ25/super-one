"use client"

import { useEffect, useRef, useState } from "react"

export interface ElementSize {
  width: number
  height: number
}

/**
 * Observes an element's content box.
 *
 * Marketing surfaces size themselves in `em` and fractions of a grid, while the
 * desktop mocks they embed lay their parts out from a numeric pixel `size`.
 * Bridging the two means measuring, not guessing — a hardcoded size drifts the
 * moment a breakpoint changes.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}
