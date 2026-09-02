import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"
import type { Locale } from "@/i18n/routing"
import { allCategoryParams, getCategory } from "@/lib/features/taxonomy"
import { FeaturesShell } from "@/components/features/features-shell"
import { CategoryView } from "@/components/features/category-view"

export function generateStaticParams() {
  return allCategoryParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>
}): Promise<Metadata> {
  const { locale, category } = await params
  const cat = getCategory(category)
  if (!cat) return {}
  return { title: `${cat.title[locale as Locale]} · Features` }
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; category: string }>
}) {
  const { locale, category } = await params
  setRequestLocale(locale)
  const cat = getCategory(category)
  if (!cat) notFound()
  return (
    <FeaturesShell locale={locale as Locale}>
      <CategoryView locale={locale as Locale} category={cat} />
    </FeaturesShell>
  )
}
