"use client"

import {
  BrandScope,
  HARNESS_HUE,
  HarnessAgentIcon,
} from "@superone/desktop-mocks/desktop"

/**
 * Stand-in "mock" for the personalize category: the same chat surface rendered
 * under six brand hues. There is no desktop mock for theming itself, because
 * theming *is* the thing every other mock inherits — so we show the inheritance.
 */
const SWATCHES = [
  { hue: HARNESS_HUE.claude, harness: "claude" as const },
  { hue: HARNESS_HUE.codex, harness: "codex" as const },
  { hue: 265, harness: "claude" as const },
  { hue: 210, harness: "codex" as const },
  { hue: 150, harness: "claude" as const },
  { hue: 330, harness: "codex" as const },
]

export function BrandHueStrip() {
  return (
    <div className="grid h-full w-full grid-cols-6 gap-3 p-4">
      {SWATCHES.map(({ hue, harness }, i) => (
        <BrandScope
          key={`${harness}-${hue}`}
          brandHue={hue}
          darkMode={i % 2 === 1}
          className="border-border bg-card flex flex-col gap-2.5 rounded-lg border p-3"
        >
          <div className="flex items-center gap-2">
            <span className="bg-primary/15 flex size-7 items-center justify-center rounded-md">
              <HarnessAgentIcon harness={harness} size={16} />
            </span>
            <span className="bg-primary h-1.5 flex-1 rounded-full" />
          </div>
          <span className="bg-muted h-1.5 w-full rounded-full" />
          <span className="bg-muted h-1.5 w-2/3 rounded-full" />
          <span className="bg-primary text-primary-foreground mt-auto rounded-md px-2 py-1 text-center text-[10px] font-medium">
            Send
          </span>
        </BrandScope>
      ))}
    </div>
  )
}
