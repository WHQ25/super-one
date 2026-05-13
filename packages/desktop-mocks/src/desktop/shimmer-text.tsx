"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"

const SHIMMER_BASE: CSSProperties = {
  background:
    "linear-gradient(90deg, currentColor 25%, oklch(0.7 0 0 / 0.6) 50%, currentColor 75%)",
  backgroundSize: "200% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
}

const SHIMMER_DURATION_SEC = 2

function shimmerOffset(seconds: number) {
  const phase = (seconds % SHIMMER_DURATION_SEC) / SHIMMER_DURATION_SEC
  const eased = 0.5 - Math.cos(phase * Math.PI) / 2
  return 200 - 400 * eased
}

export interface ShimmerTextProps {
  children: ReactNode
  frame?: number
  fps?: number
  className?: string
}

export function ShimmerText({ children, frame, fps = 30, className }: ShimmerTextProps) {
  const isFrameDriven = frame !== undefined
  const [now, setNow] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (isFrameDriven) return
    if (typeof requestAnimationFrame === "undefined") return
    const start = performance.now()
    const tick = () => {
      setNow(performance.now() - start)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isFrameDriven])

  const seconds = isFrameDriven ? frame! / fps : now / 1000
  const pos = shimmerOffset(seconds)

  return (
    <span className={className} style={{ ...SHIMMER_BASE, backgroundPositionX: `${pos}%` }}>
      {children}
    </span>
  )
}
