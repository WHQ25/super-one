import { ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { featureTaxonomy } from "@/lib/features/taxonomy"

interface FeatureHubProps {
  locale: Locale
}

const STARTERS = [
  {
    href: "/features/engines/dual-harness",
    titleKey: "hub.start.harness.title",
    descKey: "hub.start.harness.desc",
  },
  {
    href: "/features/engines/claude-core/plan-mode",
    titleKey: "hub.start.plan.title",
    descKey: "hub.start.plan.desc",
  },
  {
    href: "/features/engines/claude-core/permission-modes",
    titleKey: "hub.start.permissions.title",
    descKey: "hub.start.permissions.desc",
  },
  {
    href: "/features/extend/mini-apps",
    titleKey: "hub.start.miniapps.title",
    descKey: "hub.start.miniapps.desc",
  },
] as const

export function FeatureHub({ locale }: FeatureHubProps) {
  const t = useTranslations("Features")

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <span className="text-muted-foreground/70 text-[11px] font-medium uppercase tracking-wider">
          {t("hub.eyebrow")}
        </span>
        <h1 className="font-serif-display text-3xl tracking-tight sm:text-4xl">
          {t("hub.title")}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          {t("hub.tagline")}
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-medium">{t("hub.startHere")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {STARTERS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              className="border-border bg-card/40 hover:bg-card hover:border-border/80 group flex flex-col gap-2 rounded-2xl border p-5 transition-colors"
            >
              <span className="text-muted-foreground text-xs">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-foreground text-base font-medium">
                {t(s.titleKey)}
              </span>
              <span className="text-muted-foreground text-sm leading-relaxed">
                {t(s.descKey)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium">{t("hub.browseByArea")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featureTaxonomy.map((cat) => (
            <Link
              key={cat.slug}
              href={`/features/${cat.slug}` as const}
              className="border-border bg-card/30 hover:bg-card hover:border-border/80 group flex flex-col gap-2 rounded-2xl border p-5 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-foreground text-[15px] font-medium">
                  {cat.title[locale]}
                </span>
                <ArrowRight className="text-muted-foreground/60 size-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="text-muted-foreground text-[13px] leading-relaxed">
                {cat.blurb[locale]}
              </p>
              <span className="text-muted-foreground/70 mt-1 text-[11px]">
                {t("hub.featureCount", { count: cat.features.length })}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
