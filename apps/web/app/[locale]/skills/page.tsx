import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { listSkills } from "@/lib/marketplace/api-server"
import type { SkillListResponse } from "@/lib/marketplace/api"
import { MarketplaceHero } from "@/components/marketplace/marketplace-hero"
import { SkillsBrowser } from "@/components/marketplace/skills-browser"

export const dynamic = "force-dynamic"

export default async function SkillsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const initial = await listSkills()
  return <SkillsPageContent locale={locale as Locale} initial={initial} />
}

function SkillsPageContent({
  locale,
  initial,
}: {
  locale: Locale
  initial: SkillListResponse
}) {
  const t = useTranslations("Skills")
  return (
    <main className="pb-24">
      <MarketplaceHero
        badge={t("badge")}
        title={t("title")}
        tagline={t("tagline")}
        totalLabel={t("totalLabel", { count: initial.total })}
      />
      <SkillsBrowser locale={locale} initial={initial} />
    </main>
  )
}
