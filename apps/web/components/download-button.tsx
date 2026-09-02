"use client"

import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@superone/ui/components/ui/button"
import { cn } from "@superone/ui/lib/utils"
import {
  DOWNLOAD_TARGETS,
  downloadUrl,
  type DownloadTarget,
} from "@/lib/download"
import {
  detectPlatform,
  PLATFORM_LABELS,
  type DesktopPlatform,
} from "@/lib/platform"

const PILL_BASE =
  "bg-foreground text-background hover:bg-foreground/90 text-base font-bold tracking-tight duration-200"

function targetLabel(target: DownloadTarget): string {
  const base = PLATFORM_LABELS[target.platform]
  return target.archLabel ? `${base} (${target.archLabel})` : base
}

export function DownloadButton({ className }: { className?: string }) {
  const t = useTranslations("Home.download")
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent))
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  if (!platform) {
    return (
      <Button
        size="lg"
        className={cn(PILL_BASE, "rounded-full px-5", className)}
        disabled
      >
        {t("detecting")}
      </Button>
    )
  }

  const primary =
    DOWNLOAD_TARGETS.find((target) => target.platform === platform) ??
    DOWNLOAD_TARGETS[0]
  const others = DOWNLOAD_TARGETS.filter((target) => target !== primary)

  return (
    <div
      ref={wrapRef}
      className={cn("relative inline-flex items-center", className)}
    >
      <div className="inline-flex items-center transition-transform duration-200 hover:scale-105">
        <Button
          size="lg"
          asChild
          className={cn(PILL_BASE, "rounded-l-full rounded-r-none pr-3 pl-5")}
        >
          <a href={downloadUrl(primary.platform, primary.arch)} download>
            {t("cta", { platform: targetLabel(primary) })}
          </a>
        </Button>
        <Button
          size="lg"
          variant="default"
          aria-label={t("other")}
          onClick={toggle}
          className={cn(
            PILL_BASE,
            "border-background/15 rounded-l-none rounded-r-full border-l px-3",
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Button>
      </div>

      {open && (
        <div className="bg-popover/95 text-popover-foreground border-border absolute top-full left-1/2 z-20 mt-3 min-w-60 -translate-x-1/2 overflow-hidden rounded-2xl border shadow-xl backdrop-blur">
          {others.map((target) => (
            <a
              key={`${target.platform}-${target.arch ?? ""}`}
              href={downloadUrl(target.platform, target.arch)}
              download
              className="hover:bg-accent hover:text-accent-foreground flex items-center px-4 py-2.5 text-sm transition-colors"
            >
              {t("cta", { platform: targetLabel(target) })}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
