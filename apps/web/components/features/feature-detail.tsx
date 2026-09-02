import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import {
  getCategory,
  getFeature,
  neighborSubFeatures,
  type SubFeature,
} from "@/lib/features/taxonomy"
import { getSubFeatureBody } from "@/content/features"
import { FeaturePlayer } from "./feature-player"

interface FeatureDetailProps {
  locale: Locale
  sub: SubFeature
}

export function FeatureDetail({ locale, sub }: FeatureDetailProps) {
  const t = useTranslations("Features")
  const Body = getSubFeatureBody(sub.category, sub.feature, sub.slug, locale)
  const category = getCategory(sub.category)
  const feature = getFeature(sub.category, sub.feature)
  const { prev, next } = neighborSubFeatures(sub.category, sub.feature, sub.slug)

  return (
    <article className="flex flex-col gap-10">
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
        {feature ? (
          <>
            <Link
              href={`/features/${sub.category}/${sub.feature}` as const}
              className="hover:text-foreground transition-colors"
            >
              {feature.title[locale]}
            </Link>
            <span>/</span>
          </>
        ) : null}
        <span className="text-foreground/80">{sub.title[locale]}</span>
      </nav>

      <header className="flex flex-col gap-3">
        <h1 className="font-serif-display text-3xl tracking-tight sm:text-4xl">
          {sub.title[locale]}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          {sub.blurb[locale]}
        </p>
      </header>

      <FeaturePlayer videoId={sub.videoId} caption={t("detail.clickToPlay")} />

      {Body ? (
        <div className="text-foreground/90 max-w-3xl text-[15px]">
          <Body />
        </div>
      ) : null}

      <footer className="border-border mt-4 grid gap-3 border-t pt-8 sm:grid-cols-2">
        {prev ? (
          <Link
            href={
              `/features/${prev.category}/${prev.feature}/${prev.slug}` as const
            }
            className="border-border bg-card/30 hover:bg-card group flex flex-col gap-1 rounded-xl border p-4 transition-colors"
          >
            <span className="text-muted-foreground/80 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider">
              <ArrowLeft className="size-3" />
              {t("detail.prev")}
            </span>
            <span className="text-foreground text-sm font-medium">
              {prev.title[locale]}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={
              `/features/${next.category}/${next.feature}/${next.slug}` as const
            }
            className="border-border bg-card/30 hover:bg-card group flex flex-col items-end gap-1 rounded-xl border p-4 text-right transition-colors"
          >
            <span className="text-muted-foreground/80 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider">
              {t("detail.next")}
              <ArrowRight className="size-3" />
            </span>
            <span className="text-foreground text-sm font-medium">
              {next.title[locale]}
            </span>
          </Link>
        ) : null}
      </footer>
    </article>
  )
}
