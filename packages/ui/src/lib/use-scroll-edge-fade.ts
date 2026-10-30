import { useCallback, useRef } from "react"
import { watchScrollEdgeFade } from "./scroll-edge-fade"

/**
 * Callback ref for the vertical scroll-edge fade. Chromium keeps a finished
 * timeline after the overflow collapses; the watcher restarts it. React calls
 * this with null on unmount, which releases the watcher.
 */
export function useScrollEdgeFade<T extends HTMLElement>(enabled = true) {
  const stopRef = useRef<(() => void) | null>(null)
  return useCallback((node: T | null) => {
    stopRef.current?.()
    stopRef.current = node && enabled ? watchScrollEdgeFade(node, "block") : null
  }, [enabled])
}
