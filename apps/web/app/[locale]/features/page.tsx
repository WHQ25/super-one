import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { FeaturesShell } from "@/components/features/features-shell"
import { FeatureHub } from "@/components/features/feature-hub"

export const metadata: Metadata = {
  title: "Features",
}

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return (
    <FeaturesShell locale={locale as Locale}>
      <FeatureHub locale={locale as Locale} />
    </FeaturesShell>
  )
}
