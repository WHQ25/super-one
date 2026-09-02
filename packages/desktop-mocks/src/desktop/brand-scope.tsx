import { type CSSProperties, type ReactNode } from "react"
import { HARNESS_DEFAULT_BRAND_HUE } from "@superone/shared/harness-brand"
import { cn } from "@superone/ui/lib/utils"
import type { Harness } from "./icons"

export const HARNESS_CLAUDE_HUE = HARNESS_DEFAULT_BRAND_HUE.claude
export const HARNESS_CODEX_HUE = HARNESS_DEFAULT_BRAND_HUE.codex
export const HARNESS_HUE: Record<Harness, number> = { ...HARNESS_DEFAULT_BRAND_HUE }

export interface BrandScopeProps {
  brandHue?: number
  harness?: Harness
  darkMode?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function BrandScope({
  brandHue,
  harness,
  darkMode = false,
  children,
  className,
  style,
}: BrandScopeProps) {
  const resolvedHue = brandHue ?? (harness ? HARNESS_HUE[harness] : HARNESS_CLAUDE_HUE)
  const wrapperStyle: CSSProperties = darkMode
    ? { ...style }
    : ({ "--brand-hue": String(((resolvedHue % 360) + 360) % 360), ...style } as CSSProperties)

  return (
    <div
      className={cn(
        "h-full w-full",
        darkMode ? "dark bg-background text-foreground" : "brand-scope",
        className,
      )}
      style={wrapperStyle}
    >
      {children}
    </div>
  )
}
