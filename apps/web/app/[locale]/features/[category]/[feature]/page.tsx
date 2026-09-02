import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { allFeatureParams, getFeature } from "@/lib/features/taxonomy"
import { FeaturesShell } from "@/components/features/features-shell"
import { FeatureView } from "@/components/features/feature-view"

export function generateStaticParams() {
  return allFeatureParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string; feature: string }>
}): Promise<Metadata> {
  const { locale, category, feature } = await params
  const f = getFeature(category, feature)
  if (!f) return {}
  return { title: `${f.title[locale as Locale]} · Features` }
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ locale: string; category: string; feature: string }>
}) {
  const { locale, category, feature } = await params
  setRequestLocale(locale)
  const f = getFeature(category, feature)
  if (!f) notFound()
  return (
    <FeaturesShell locale={locale as Locale}>
      <FeatureView locale={locale as Locale} feature={f} />
    </FeaturesShell>
  )
}
