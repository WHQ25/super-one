"use client"

import type { CSSProperties, ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"
import { useBrandHue } from "@/components/providers/brand-hue-provider"

interface BrandedSurfaceProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /**
   * Render the surface as a Liquid Glass window in dark mode: a wallpaper
   * behind it and a frosted, translucent shell on top, with the shared glass
   * tokens (`--sidebar: transparent`, `--card` at 0.72) resolving inside.
   * Light mode is unaffected — the desktop keeps light surfaces opaque too.
   */
  glass?: boolean
}

/**
 * Wrapper for anything that simulates the desktop app. It owns the brand hue
 * (light mode) and, in dark mode, follows the page theme the way the desktop
 * does: neutral dark palette, optionally under Liquid Glass.
 *
 * Theme resolution is CSS-only (`.dark .brand-scope` in theme.css) so there is
 * no hydration flash while next-themes settles.
 */
export function BrandedSurface({
  children,
  className,
  style,
  glass = true,
}: BrandedSurfaceProps) {
  const { brandHue } = useBrandHue()
  const mergedStyle = {
    ...style,
    "--brand-hue": brandHue,
  } as CSSProperties
  return (
    <div
      className={cn(
        "brand-scope relative isolate bg-background text-foreground",
        glass && "liquid-glass dark:bg-transparent",
        className,
      )}
      style={mergedStyle}
    >
      {glass && (
        <>
          <div aria-hidden className="mock-wallpaper absolute inset-0 -z-20 hidden dark:block" />
          <div aria-hidden className="mock-glass absolute inset-0 -z-10 hidden dark:block" />
        </>
      )}
      {children}
    </div>
  )
}
