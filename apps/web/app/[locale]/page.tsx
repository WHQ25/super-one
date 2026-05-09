import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Button } from "@superone/ui/components/ui/button"
import { BrandedSurface } from "@/components/branded-surface"

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <HomeContent />
}

function HomeContent() {
  const t = useTranslations("Home")
  return (
    <main className="flex flex-1 flex-col items-center gap-12 px-4 py-16">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-md text-lg text-muted-foreground">{t("tagline")}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg">{t("getStarted")}</Button>
          <Button size="lg" variant="outline">
            {t("learnMore")}
          </Button>
        </div>
      </div>

      <BrandedSurface className="w-full max-w-3xl rounded-2xl border border-border p-8 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">Simulated app surface</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
          </div>
        </div>
      </BrandedSurface>
    </main>
  )
}
