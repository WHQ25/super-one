import { type CSSProperties, type ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"

export const HARNESS_CLAUDE_HUE = 42
export const HARNESS_CODEX_HUE = 165

export interface BrandScopeProps {
  brandHue?: number
  darkMode?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function BrandScope({
  brandHue = HARNESS_CLAUDE_HUE,
  darkMode = false,
  children,
  className,
  style,
}: BrandScopeProps) {
  const wrapperStyle: CSSProperties = darkMode
    ? { ...style }
    : ({ "--brand-hue": String(((brandHue % 360) + 360) % 360), ...style } as CSSProperties)

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
