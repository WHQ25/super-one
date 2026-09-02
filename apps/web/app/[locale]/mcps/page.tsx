import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { listMcps } from "@/lib/marketplace/api-server"
import type { McpListResponse } from "@/lib/marketplace/api"
import { MarketplaceHero } from "@/components/marketplace/marketplace-hero"
import { McpsBrowser } from "@/components/marketplace/mcps-browser"

export const dynamic = "force-dynamic"

export default async function McpsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const initial = await listMcps()
  return <McpsPageContent locale={locale as Locale} initial={initial} />
}

function McpsPageContent({
  locale,
  initial,
}: {
  locale: Locale
  initial: McpListResponse
}) {
  const t = useTranslations("Mcps")
  return (
    <main className="pb-24">
      <MarketplaceHero
        badge={t("badge")}
        title={t("title")}
        tagline={t("tagline")}
        totalLabel={t("totalLabel", { count: initial.total })}
      />
      <McpsBrowser locale={locale} initial={initial} />
    </main>
  )
}
