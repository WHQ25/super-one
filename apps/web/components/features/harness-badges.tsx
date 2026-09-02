import type { CSSProperties } from "react"
import {
  HARNESS_HUE,
  HARNESS_SHOWCASE,
  HarnessSessionIcon,
} from "@superone/desktop-mocks/desktop"
import type { HarnessId } from "@superone/shared/agent-types"
import { cn } from "@superone/ui/lib/utils"

const SHORT_LABEL = new Map(HARNESS_SHOWCASE.map((h) => [h.id, h.shortLabel]))

/**
 * Marks which engines expose a feature.
 *
 * Each badge stamps `--brand-hue` and opts into `.brand-scope`, so the colour
 * comes from the same source the desktop tints itself with rather than from a
 * hand-picked palette that would need a new entry per harness. Rendering
 * nothing for an empty list is deliberate: a feature with no harnesses listed
 * is harness-agnostic, and badging it "all six" would be noise.
 */
export function HarnessBadges({
  harnesses,
  className,
}: {
  harnesses?: HarnessId[]
  className?: string
}) {
  if (!harnesses?.length) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {harnesses.map((id) => (
        <span
          key={id}
          style={{ "--brand-hue": String(HARNESS_HUE[id]) } as CSSProperties}
          className="brand-scope bg-primary/12 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase"
        >
          <HarnessSessionIcon harness={id} status="default" size={11} />
          {SHORT_LABEL.get(id) ?? id}
        </span>
      ))}
    </span>
  )
}
