import { ArrowLeft } from "lucide-react"
import { notFound } from "next/navigation"
import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { getSkill } from "@/lib/marketplace/api-server"
import { SKILLS } from "@/lib/marketplace/mock-db"
import type { SkillEntry } from "@/lib/marketplace/types"
import { AvatarTile } from "@/components/marketplace/avatar-tile"
import { InstallButton } from "@/components/marketplace/install-button"

export const dynamic = "force-dynamic"

export function generateStaticParams() {
  return SKILLS.map((s) => ({ slug: s.slug }))
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const entry = await getSkill(slug)
  if (!entry) notFound()
  return <SkillDetailContent locale={locale as Locale} entry={entry} />
}

function SkillDetailContent({
  locale,
  entry,
}: {
  locale: Locale
  entry: SkillEntry
}) {
  const t = useTranslations("Skills")
  const tCat = useTranslations("Skills.categories")

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <Link
        href="/skills"
        className="text-muted-foreground hover:text-foreground mb-10 inline-flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("detail.back")}
      </Link>

      <header className="border-border bg-card/40 flex flex-col gap-6 rounded-3xl border p-6 sm:flex-row sm:items-start sm:gap-8 sm:p-8">
        <AvatarTile emoji={entry.emoji} hue={entry.hue} size="lg" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground/80 text-[12px]">
              {tCat(entry.category)}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                entry.authorType === "official"
                  ? "border-foreground/20 bg-foreground/5"
                  : "border-border/60 text-muted-foreground bg-background"
              }`}
            >
              {entry.authorType === "official" ? t("official") : t("community")}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {entry.name[locale]}
          </h1>
          <p className="text-muted-foreground text-pretty text-[15px]">
            {entry.tagline[locale]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <InstallButton kind="skill" slug={entry.slug} />
            <span className="text-muted-foreground/70 text-xs">
              {t("byAuthor", { name: entry.authorName })}
            </span>
          </div>
        </div>
      </header>

      <section className="mt-12 grid gap-12 md:grid-cols-[1fr_220px]">
        <div className="flex flex-col gap-10">
          <div>
            <h2 className="text-foreground/90 mb-3 text-xs font-semibold uppercase tracking-wider">
              {t("detail.about")}
            </h2>
            <p className="text-foreground/90 text-[15px] leading-relaxed">
              {entry.description[locale]}
            </p>
          </div>

          {entry.examplePrompts.length > 0 ? (
            <div>
              <h2 className="text-foreground/90 mb-3 text-xs font-semibold uppercase tracking-wider">
                {t("detail.examplePrompts")}
              </h2>
              <ul className="flex flex-col gap-2">
                {entry.examplePrompts.map((prompt, idx) => (
                  <li
                    key={idx}
                    className="border-border bg-background text-foreground/90 rounded-xl border px-4 py-3 text-[14px] leading-relaxed"
                  >
                    {prompt[locale]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t("detail.publishedBy")}
            </h3>
            <span className="text-foreground/90 text-sm">{entry.authorName}</span>
          </div>
          <div>
            <h3 className="text-muted-foreground/80 mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {t("detail.tags")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
