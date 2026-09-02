import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Badge } from "@superone/ui/components/ui/badge"
import { DemosGallery } from "@/components/demos/demos-gallery"

export default async function DemosPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DemosContent />
}

function DemosContent() {
  const t = useTranslations("Demos")
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-20 px-4 py-16 sm:px-6 sm:py-24">
      <header className="flex max-w-4xl flex-col items-start gap-5">
        <Badge variant="secondary">{t("release")}</Badge>
        <div className="flex flex-col gap-4">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </header>

      <DemosGallery />
    </main>
  )
}
