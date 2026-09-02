import { ArrowRight, ChevronLeft } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@superone/ui/lib/utils"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { getCategory, type Feature } from "@/lib/features/taxonomy"
import { FeaturePlayer } from "./feature-player"
import { HarnessBadges } from "./harness-badges"

interface FeatureViewProps {
  locale: Locale
  feature: Feature
}

export function FeatureView({ locale, feature }: FeatureViewProps) {
  const t = useTranslations("Features")
  const category = getCategory(feature.category)

  return (
    <div className="flex flex-col gap-10">
      <nav className="text-muted-foreground/80 flex flex-wrap items-center gap-1.5 text-xs">
        <Link
          href="/features"
          className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="size-3" />
          {t("detail.crumbRoot")}
        </Link>
        <span>/</span>
        {category ? (
          <>
            <Link
              href={`/features/${category.slug}` as const}
              className="hover:text-foreground transition-colors"
            >
              {category.title[locale]}
            </Link>
            <span>/</span>
          </>
        ) : null}
        <span className="text-foreground/80">{feature.title[locale]}</span>
      </nav>

      <header className="flex flex-col gap-3">
        <span className="text-muted-foreground/70 text-[11px] font-medium uppercase tracking-wider">
          {t("feature.eyebrow")}
        </span>
        <h1 className="font-serif-display text-3xl tracking-tight sm:text-4xl">
          {feature.title[locale]}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          {feature.blurb[locale]}
        </p>
      </header>

      {feature.videoId ? (
        <FeaturePlayer
          videoId={feature.videoId}
          caption={t("detail.clickToPlay")}
        />
      ) : null}

      <ul className="flex flex-col gap-5">
        {feature.subFeatures.map((s) => (
          <li key={s.slug}>
            <Link
              href={
                `/features/${feature.category}/${feature.slug}/${s.slug}` as const
              }
              className="border-border bg-card/30 hover:bg-card hover:border-border/80 group grid gap-5 rounded-2xl border p-5 transition-colors sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6"
            >
              <FeaturePlayer videoId={s.videoId} />
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground text-lg font-medium">
                    {s.title[locale]}
                  </span>
                  <HarnessBadges harnesses={s.harnesses} />
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {s.blurb[locale]}
                </p>
                <span className="text-foreground/80 mt-1 inline-flex items-center gap-1 text-sm">
                  {t("category.readMore")}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

