"use client"

import type { ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"
import { BrandedSurface } from "@/components/branded-surface"
import { useElementSize } from "@/lib/use-element-size"

interface MockStageProps {
  children: ReactNode
  /** Natural width the mock is authored at, in px. Drives the scale factor. */
  width: number
  /** Clip the scaled result to at most this many px tall. */
  maxHeight?: number
  /** Never scale past this. Keeps small mocks from being blown up. */
  maxScale?: number
  className?: string
}

/**
 * Fits a full-size desktop mock into an arbitrary marketing slot.
 *
 * Mocks are authored at real desktop dimensions, so showing one inside a bento
 * cell means scaling the whole subtree. Two measurements are needed, not one:
 * the outer box gives the available width (→ scale), and the content box gives
 * the natural height. The stage height is their product, so a slot never ends
 * up with dead space below a shrunken mock or a mock cut off mid-row.
 */
export function MockStage({
  children,
  width,
  maxHeight,
  maxScale = 1,
  className,
}: MockStageProps) {
  const [outerRef, outer] = useElementSize<HTMLDivElement>()
  const [contentRef, content] = useElementSize<HTMLDivElement>()

  const scale = outer.width > 0 ? Math.min(outer.width / width, maxScale) : 0
  const measured = scale > 0 && content.height > 0
  const scaledHeight = content.height * scale
  const stageHeight = measured
    ? maxHeight
      ? Math.min(scaledHeight, maxHeight)
      : scaledHeight
    : undefined

  return (
    <BrandedSurface
      className={cn(
        "border-border bg-card relative overflow-hidden rounded-xl border",
        className,
      )}
    >
      <div
        ref={outerRef}
        className={cn(
          "w-full transition-opacity duration-200",
          measured ? "opacity-100" : "opacity-0",
        )}
        style={{ height: stageHeight }}
      >
        <div
          ref={contentRef}
          className="pointer-events-none origin-top-left"
          style={{ width, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </BrandedSurface>
  )
}
