import { setRequestLocale } from "next-intl/server"
import { Hero } from "@/components/home/hero"
import { Bento } from "@/components/home/bento"
import { FeatureRows } from "@/components/home/feature-rows"
import { FinalCta } from "@/components/home/final-cta"

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <Bento />
      <FeatureRows />
      <FinalCta />
    </main>
  )
}
