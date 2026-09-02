import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { allSubFeatureParams, getSubFeature } from "@/lib/features/taxonomy"
import { FeaturesShell } from "@/components/features/features-shell"
import { FeatureDetail } from "@/components/features/feature-detail"

export function generateStaticParams() {
  return allSubFeatureParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{
    locale: string
    category: string
    feature: string
    sub: string
  }>
}): Promise<Metadata> {
  const { locale, category, feature, sub } = await params
  const s = getSubFeature(category, feature, sub)
  if (!s) return {}
  return { title: `${s.title[locale as Locale]} · Features` }
}

export default async function SubFeatureDetailPage({
  params,
}: {
  params: Promise<{
    locale: string
    category: string
    feature: string
    sub: string
  }>
}) {
  const { locale, category, feature, sub } = await params
  setRequestLocale(locale)
  const s = getSubFeature(category, feature, sub)
  if (!s) notFound()
  return (
    <FeaturesShell locale={locale as Locale}>
      <FeatureDetail locale={locale as Locale} sub={s} />
    </FeaturesShell>
  )
}
