"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { Locale } from "@/i18n/routing"
import { listSkills, type SkillListResponse } from "@/lib/marketplace/api"
import type { SkillCategory } from "@/lib/marketplace/types"
import { CategoryRail, type CategoryOption } from "./category-rail"
import { SearchInput } from "./search-input"
import { SkillCard } from "./skill-card"

const ALL_CATEGORIES: ReadonlyArray<SkillCategory> = [
  "development",
  "writing",
  "research",
  "data",
  "productivity",
  "creative",
]

export function SkillsBrowser({
  locale,
  initial,
}: {
  locale: Locale
  initial: SkillListResponse
}) {
  const t = useTranslations("Skills")
  const tCat = useTranslations("Skills.categories")
  const [category, setCategory] = useState<SkillCategory | "all">("all")
  const [query, setQuery] = useState("")
  const [data, setData] = useState<SkillListResponse>(initial)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      listSkills({ category, q: query }, { signal: controller.signal })
        .then((res) => setData(res))
        .catch((err) => {
          if ((err as { name?: string }).name !== "AbortError") {
            console.error(err)
          }
        })
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [category, query])

  const options = useMemo<CategoryOption[]>(() => {
    const counts = new Map<SkillCategory, number>()
    for (const item of initial.items) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
    }
    return [
      { value: "all", label: tCat("all"), count: initial.total },
      ...ALL_CATEGORIES.map((c) => ({
        value: c,
        label: tCat(c),
        count: counts.get(c) ?? 0,
      })),
    ]
  }, [initial, tCat])

  const featured = data.featured

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="mx-auto mb-12 w-full max-w-xl">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("searchPlaceholder")}
        />
      </div>

      {!query && category === "all" && featured.length > 0 ? (
        <section className="mb-14">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-foreground/90 text-sm font-semibold uppercase tracking-wider">
              {t("featured")}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((entry) => (
              <SkillCard
                key={entry.slug}
                entry={entry}
                locale={locale}
                variant="featured"
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-8 md:grid-cols-[200px_1fr]">
        <CategoryRail
          heading={t("browseAll")}
          options={options}
          value={category}
          onChange={(next) => setCategory(next as SkillCategory | "all")}
        />
        <div>
          {data.items.length === 0 ? (
            <div className="border-border bg-card/30 text-muted-foreground rounded-2xl border border-dashed px-6 py-16 text-center text-sm">
              {t("noResults")}
            </div>
          ) : (
            <div
              className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${loading ? "opacity-70" : ""} transition-opacity`}
            >
              {data.items.map((entry) => (
                <SkillCard key={entry.slug} entry={entry} locale={locale} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
