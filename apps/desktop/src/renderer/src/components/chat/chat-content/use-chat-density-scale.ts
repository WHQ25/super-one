import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react'

const CHAT_SCALABLE_REM_TOKENS = {
  '--spacing': 0.25,
  '--text-2xs': 0.625,
  '--text-xs': 0.75,
  '--text-sm': 0.875,
  '--text-base': 1,
  '--container-3xl': 48,
} as const

function createChatDensityStyle(scale: number): CSSProperties {
  return Object.fromEntries(
    Object.entries(CHAT_SCALABLE_REM_TOKENS).map(([token, rem]) => [
      token,
      `${Math.round(rem * scale * 100000) / 100000}rem`,
    ]),
  ) as CSSProperties
}

export function useChatDensityScale(containerRef: RefObject<HTMLDivElement | null>): CSSProperties {
  const computeAutoScale = useCallback((w: number) => (w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1), [])
  const [autoScale, setAutoScale] = useState(1)
  const [manualScaleOffset, setManualScaleOffset] = useState(0)
  const uiScale = autoScale + manualScaleOffset
  const densityStyle = useMemo(() => createChatDensityStyle(uiScale), [uiScale])

  useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    setAutoScale(computeAutoScale(parent.getBoundingClientRect().width))
    let rafId = 0
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const next = computeAutoScale(entries[0]?.contentRect.width ?? 0)
        setAutoScale((prev) => (prev === next ? prev : next))
      })
    })
    observer.observe(parent)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [computeAutoScale, containerRef])

  useEffect(() => {
    return window.app.onContentZoom((action) => {
      if (!containerRef.current?.matches(':hover')) return
      if (action === 'reset') setManualScaleOffset(0)
      else if (action === 'in') setManualScaleOffset((v) => Math.min(v + 0.05, 0.5))
      else setManualScaleOffset((v) => Math.max(v - 0.05, -0.5))
    })
  }, [containerRef])

  return densityStyle
}
