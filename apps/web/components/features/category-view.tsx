"use client"

import { useState } from "react"
import { ArrowRight, ChevronLeft } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@superone/ui/lib/utils"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import {
  featuresForHarness,
  type FeatureCategory,
} from "@/lib/features/taxonomy"
import { FeaturePlayer } from "./feature-player"

interface CategoryViewProps {
  locale: Locale
  category: FeatureCategory
}

type HarnessFilter = "all" | "claude" | "codex"

export function CategoryView({ locale, category }: CategoryViewProps) {
  const t = useTranslations("Features")
  const [filter, setFilter] = useState<HarnessFilter>("all")
  const features = featuresForHarness(category, filter)

  return (
    <div className="flex flex-col gap-10">
      <Link
        href="/features"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-4" />
        {t("category.back")}
      </Link>

      <header className="flex flex-col gap-3">
        <span className="text-muted-foreground/70 text-[11px] font-medium uppercase tracking-wider">
          {t("category.eyebrow")}
        </span>
        <h1 className="font-serif-display text-3xl tracking-tight sm:text-4xl">
          {category.title[locale]}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          {category.blurb[locale]}
        </p>
      </header>

      {category.harnessTabs ? (
        <div className="border-border flex w-fit items-center gap-1 rounded-full border p-1 text-sm">
          {(["all", "claude", "codex"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors",
                filter === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`category.tabs.${key}`)}
            </button>
          ))}
        </div>
      ) : null}

      {features.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          {t("category.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {features.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/features/${category.slug}/${f.slug}` as const}
                className="border-border bg-card/30 hover:bg-card hover:border-border/80 group grid gap-5 rounded-2xl border p-5 transition-colors sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6"
              >
                <FeaturePlayer videoId={f.videoId} />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-lg font-medium">
                      {f.title[locale]}
                    </span>
                    {f.harness ? <HarnessBadge harness={f.harness} /> : null}
                  </div>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {f.blurb[locale]}
                  </p>
                  <span className="text-muted-foreground/70 text-xs">
                    {t("category.subCount", { count: f.subFeatures.length })}
                  </span>
                  <span className="text-foreground/80 mt-1 inline-flex items-center gap-1 text-sm">
                    {t("category.readMore")}
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function HarnessBadge({ harness }: { harness: "claude" | "codex" | "both" }) {
  const styles = {
    claude: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    codex: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
    both: "bg-muted text-muted-foreground",
  }
  const labels = { claude: "Claude", codex: "Codex", both: "Claude + Codex" }
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        styles[harness],
      )}
    >
      {labels[harness]}
    </span>
  )
}
