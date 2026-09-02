"use client"

import {
  BrandScope,
  HARNESS_HUE,
  HARNESS_SHOWCASE,
  HarnessSessionIcon,
} from "@superone/desktop-mocks/desktop"

/**
 * The Integrate pillar, shown rather than claimed: every harness SuperOne can
 * drive, each in its own brand hue. Sourced from HARNESS_SHOWCASE so adding a
 * harness to the catalog adds it here — the homepage can't drift out of date.
 */
export function HarnessLineup() {
  return (
    <div className="grid h-full w-full grid-cols-2 gap-2.5 p-4 sm:grid-cols-3">
      {HARNESS_SHOWCASE.map((h) => (
        <BrandScope
          key={h.id}
          brandHue={HARNESS_HUE[h.id]}
          className="border-border bg-card flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
        >
          <span className="bg-primary/12 flex size-8 shrink-0 items-center justify-center rounded-md">
            <HarnessSessionIcon
              harness={h.id}
              status="default"
              size={18}
              renderLevel="rich"
            />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] leading-tight font-medium">
              {h.label}
            </span>
            <span className="text-muted-foreground truncate text-[11px] leading-tight">
              {h.model}
            </span>
          </span>
        </BrandScope>
      ))}
    </div>
  )
}
