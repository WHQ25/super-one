import { useFormatter, useTranslations } from "next-intl"
import type { Locale } from "@/i18n/routing"
import type { ChangelogEntry } from "@/content/changelog/types"

const CATEGORY_HUE: Record<ChangelogEntry["category"], number> = {
  feature: 260,
  improvement: 200,
  fix: 30,
  announcement: 320,
}

export function EntryCard({
  entry,
  locale,
}: {
  entry: ChangelogEntry
  locale: Locale
}) {
  const t = useTranslations("Changelog")
  const format = useFormatter()
  const Body = entry.body[locale]
  const dateObj = new Date(entry.date)
  const hue = CATEGORY_HUE[entry.category]

  return (
    <article
      id={entry.slug}
      className="grid scroll-mt-24 gap-8 md:grid-cols-[200px_1fr]"
    >
      <aside className="flex flex-col gap-3 md:sticky md:top-24 md:self-start">
        <time
          dateTime={entry.date}
          className="text-muted-foreground text-sm font-medium"
        >
          {format.dateTime(dateObj, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
        <span
          className="chip-category inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
          style={{ ["--chip-hue" as string]: hue }}
        >
          <span className="chip-dot size-1.5 rounded-full" />
          {t(`categories.${entry.category}`)}
        </span>
        {entry.version ? (
          <span className="text-muted-foreground/80 font-mono text-[11px]">
            v{entry.version}
          </span>
        ) : null}
      </aside>

      <div className="border-border bg-card/40 flex flex-col overflow-hidden rounded-2xl border">
        {entry.hero ? <Hero hero={entry.hero} title={entry.title[locale]} /> : null}
        <div className="flex flex-col gap-4 px-6 py-7 sm:px-8 sm:py-8">
          <header className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {entry.title[locale]}
            </h2>
            <p className="text-muted-foreground text-pretty">
              {entry.summary[locale]}
            </p>
          </header>
          <div className="text-foreground/80 prose-changelog mt-2 text-[15px] leading-relaxed">
            <Body />
          </div>
          {entry.tags && entry.tags.length > 0 ? (
            <footer className="border-border/60 mt-4 flex flex-wrap gap-2 border-t pt-5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-0.5 text-[11px]"
                >
                  #{tag}
                </span>
              ))}
            </footer>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function Hero({
  hero,
  title,
}: {
  hero: NonNullable<ChangelogEntry["hero"]>
  title: string
}) {
  if (hero.type === "gradient") {
    return (
      <div
        className="relative aspect-[16/7] w-full overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${hero.from}, ${hero.to})`,
        }}
      >
        {hero.accent ? (
          <div
            className="absolute -right-16 -top-20 size-72 rounded-full opacity-60 blur-3xl"
            style={{ background: hero.accent }}
          />
        ) : null}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end p-6 sm:p-8">
          <span className="font-serif-display text-2xl text-white/95 sm:text-3xl">
            {title}
          </span>
        </div>
      </div>
    )
  }

  if (hero.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={hero.src} alt={hero.alt ?? title} className="aspect-[16/7] w-full object-cover" />
  }

  return (
    <video
      src={hero.src}
      poster={hero.poster}
      autoPlay
      loop
      muted
      playsInline
      className="aspect-[16/7] w-full object-cover"
    />
  )
}
