import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { ChangelogList } from "@/components/changelog/changelog-list"

export default async function ChangelogPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ChangelogContent locale={locale as Locale} />
}

function ChangelogContent({ locale }: { locale: Locale }) {
  const t = useTranslations("Changelog")

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
      <header className="flex flex-col items-start gap-4 pb-14">
        <span className="border-border bg-card/60 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
          <span className="bg-primary h-1.5 w-1.5 rounded-full" />
          {t("badge")}
        </span>
        <h1 className="font-serif-display text-4xl tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground max-w-xl text-pretty">
          {t("tagline")}
        </p>
      </header>

      <ChangelogList locale={locale} />
    </main>
  )
}
