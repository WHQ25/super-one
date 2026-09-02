"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@superone/ui/components/ui/button"
import type { Locale } from "@/i18n/routing"
import { changelogEntries } from "@/content/changelog"
import { EntryCard } from "./entry-card"

const INITIAL_COUNT = 6
const STEP = 6

export function ChangelogList({ locale }: { locale: Locale }) {
  const t = useTranslations("Changelog")
  const entries = useMemo(
    () =>
      [...changelogEntries].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [],
  )
  const [count, setCount] = useState(INITIAL_COUNT)
  const visible = entries.slice(0, count)
  const hasMore = count < entries.length
  const remaining = entries.length - count

  return (
    <>
      <div className="flex flex-col gap-16 sm:gap-20">
        {visible.map((entry) => (
          <EntryCard key={entry.slug} entry={entry} locale={locale} />
        ))}
      </div>
      {hasMore ? (
        <div className="border-border/60 mt-20 flex flex-col items-center gap-3 border-t pt-12">
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-6"
            onClick={() => setCount((c) => c + STEP)}
          >
            {t("loadMore", { remaining })}
          </Button>
          <span className="text-muted-foreground text-xs">
            {t("showing", { count, total: entries.length })}
          </span>
        </div>
      ) : entries.length > INITIAL_COUNT ? (
        <div className="text-muted-foreground/70 mt-20 border-t border-border/60 pt-10 text-center text-xs">
          {t("end")}
        </div>
      ) : null}
    </>
  )
}
