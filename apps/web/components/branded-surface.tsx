"use client"

import type { CSSProperties, ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"
import { useBrandHue } from "@/components/providers/brand-hue-provider"

interface BrandedSurfaceProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function BrandedSurface({ children, className, style }: BrandedSurfaceProps) {
  const { brandHue } = useBrandHue()
  const mergedStyle = {
    ...style,
    "--brand-hue": brandHue,
  } as CSSProperties
  return (
    <div className={cn("brand-scope bg-background text-foreground", className)} style={mergedStyle}>
      {children}
    </div>
  )
}
