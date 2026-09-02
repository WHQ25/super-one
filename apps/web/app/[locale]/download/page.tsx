import { Apple, Smartphone } from "lucide-react"
import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { Button } from "@superone/ui/components/ui/button"
import { DownloadButton } from "@/components/download-button"

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DownloadContent />
}

function DownloadContent() {
  const t = useTranslations("Download")

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
      <header className="flex flex-col items-center text-center">
        <span className="border-border bg-card/60 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
          <span className="bg-primary h-1.5 w-1.5 rounded-full" />
          {t("badge")}
        </span>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-pretty">
          {t("tagline")}
        </p>
      </header>

      <section
        id="desktop"
        className="border-border bg-card/40 mt-16 scroll-mt-24 rounded-2xl border p-8 sm:p-12"
      >
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("desktop.heading")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {t("desktop.subheading")}
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <DownloadButton />
        </div>
      </section>

      <section id="mobile" className="mt-12 scroll-mt-24">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("mobile.heading")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("mobile.subheading")}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PlatformCard
            icon={<Apple className="size-5" />}
            title={t("mobile.ios.title")}
            desc={t("mobile.ios.desc")}
            cta={t("mobile.ios.cta")}
            status={t("mobile.ios.status")}
          />
          <PlatformCard
            icon={<Smartphone className="size-5" />}
            title={t("mobile.android.title")}
            desc={t("mobile.android.desc")}
            cta={t("mobile.android.cta")}
            status={t("mobile.android.status")}
            disabled
          />
        </div>
      </section>

      <p className="text-muted-foreground mt-16 text-center text-xs">
        {t("footnote")}
      </p>
    </main>
  )
}

function PlatformCard({
  icon,
  title,
  desc,
  cta,
  status,
  disabled = false,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  cta: string
  status: string
  disabled?: boolean
}) {
  return (
    <div className="border-border bg-card/40 flex flex-col gap-4 rounded-xl border p-6">
      <div className="flex items-center justify-between">
        <div className="bg-accent/60 text-foreground flex size-10 items-center justify-center rounded-lg">
          {icon}
        </div>
        <span className="text-muted-foreground bg-background border-border rounded-full border px-2 py-0.5 text-[11px] font-medium">
          {status}
        </span>
      </div>
      <div>
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {desc}
        </p>
      </div>
      <Button
        size="sm"
        variant={disabled ? "outline" : "default"}
        className="rounded-full self-start px-4"
        disabled={disabled}
      >
        {cta}
      </Button>
    </div>
  )
}
