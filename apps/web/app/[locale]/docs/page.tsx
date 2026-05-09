import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DocsContent />
}

function DocsContent() {
  const t = useTranslations("Nav")
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("docs")}</h1>
    </main>
  )
}
