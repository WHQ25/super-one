"use client"

import { useState } from "react"
import { Play } from "lucide-react"
import { cn } from "@superone/ui/lib/utils"
import { BrandedSurface } from "@/components/branded-surface"
import type { FeatureVideoId } from "@/lib/features/taxonomy"

const VIDEO_LABEL: Record<FeatureVideoId, string> = {
  F01: "F01 · Multi-harness",
  F02: "F02 · Mini-apps",
  F03: "F03 · Remote control",
  F04: "F04 · Brand theming",
  F05: "F05 · Plan mode",
  F06: "F06 · Parallel sessions",
  F07: "F07 · Subagents",
  F08: "F08 · Worktrees",
  F09: "F09 · Permissions",
  F10: "F10 · Chat input",
}

interface FeaturePlayerProps {
  videoId?: FeatureVideoId
  caption?: string
  className?: string
}

export function FeaturePlayer({
  videoId,
  caption,
  className,
}: FeaturePlayerProps) {
  const [playing, setPlaying] = useState(false)
  const label = videoId ? VIDEO_LABEL[videoId] : "Demo"

  return (
    <BrandedSurface
      className={cn(
        "border-border bg-card relative aspect-[16/10] w-full overflow-hidden rounded-2xl border",
        className,
      )}
    >
      {playing ? (
        <div className="bg-muted/40 absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-muted-foreground text-sm">
            Loading Remotion Player…
          </div>
          <div className="text-muted-foreground/70 text-xs">
            {label}
            {caption ? ` · ${caption}` : ""}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${label}`}
          className="group absolute inset-0 flex flex-col items-center justify-center gap-4 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <span className="bg-background border-border flex h-16 w-16 items-center justify-center rounded-full border shadow-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
            <Play className="text-foreground ml-1 size-7" strokeWidth={1.6} />
          </span>
          <span className="text-muted-foreground text-xs">{label}</span>
        </button>
      )}
    </BrandedSurface>
  )
}
