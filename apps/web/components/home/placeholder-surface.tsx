import type { ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"
import { BrandedSurface } from "@/components/branded-surface"

interface PlaceholderSurfaceProps {
  label?: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * Window-chrome framed placeholder for product visuals. Wrapped in
 * <BrandedSurface> so it adopts the warm brand hue (it is a simulated app
 * surface) while the surrounding page chrome stays neutral.
 */
export function PlaceholderSurface({
  label,
  className,
  bodyClassName,
}: PlaceholderSurfaceProps) {
  return (
    <BrandedSurface
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-muted/60 px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
      </div>
      <div
        className={cn(
          "relative flex items-center justify-center",
          "bg-[radial-gradient(120%_120%_at_50%_0%,var(--secondary)_0%,var(--muted)_55%,var(--background)_100%)]",
          bodyClassName,
        )}
      >
        <span className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
    </BrandedSurface>
  )
}
