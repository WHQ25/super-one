"use client"

import { motion } from "motion/react"
import { useTranslations } from "next-intl"
import { Button } from "@superone/ui/components/ui/button"
import { Link } from "@/i18n/navigation"
import { DownloadButton } from "@/components/download-button"

export function FinalCta() {
  const t = useTranslations("Home.cta")

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="from-primary/12 via-card to-card relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br px-6 py-20 text-center"
      >
        <div
          aria-hidden
          className="bg-primary/20 pointer-events-none absolute -top-24 left-1/2 h-72 w-[680px] -translate-x-1/2 rounded-full blur-[120px]"
        />
        <h2 className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t("title")}
        </h2>
        <p className="text-muted-foreground relative mt-4 text-lg">
          {t("subtitle")}
        </p>
        <div className="relative mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <DownloadButton />
          <Button size="lg" variant="outline" asChild>
            <Link href="/demos">{t("secondary")}</Link>
          </Button>
        </div>
      </motion.div>
    </section>
  )
}
