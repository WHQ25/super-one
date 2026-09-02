"use client"

import { useState } from "react"
import { ChevronDown, Menu } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@superone/ui/lib/utils"
import { Link } from "@/i18n/navigation"
import { usePathname } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { featureTaxonomy } from "@/lib/features/taxonomy"

interface FeaturesSidebarProps {
  locale: Locale
}

export function FeaturesSidebar({ locale }: FeaturesSidebarProps) {
  const pathname = usePathname()
  const t = useTranslations("Features")
  const [open, setOpen] = useState(false)

  const nav = (
    <nav className="flex flex-col gap-0.5 px-1 pb-12 lg:pb-0">
      <Link
        href="/features"
        onClick={() => setOpen(false)}
        className={cn(
          "block rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
          pathname === "/features"
            ? "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {t("sidebar.all")}
      </Link>
      {featureTaxonomy.map((cat) => {
        const catActive = pathname.startsWith(`/features/${cat.slug}`)
        return (
          <div key={cat.slug} className="flex flex-col gap-0.5">
            <Link
              href={`/features/${cat.slug}` as const}
              onClick={() => setOpen(false)}
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
                catActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {cat.title[locale]}
            </Link>
            {catActive ? (
              <div className="border-border/60 ml-3 flex flex-col gap-0.5 border-l pl-2">
                {cat.features.map((f) => (
                  <Link
                    key={f.slug}
                    href={`/features/${cat.slug}/${f.slug}` as const}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block rounded-md px-2.5 py-1 text-[12.5px] transition-colors",
                      pathname.startsWith(`/features/${cat.slug}/${f.slug}`)
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/80 hover:text-foreground",
                    )}
                  >
                    {f.title[locale]}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="border-border bg-card text-foreground/90 hover:bg-accent flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <Menu className="size-4" />
            {t("sidebar.mobileToggle")}
          </span>
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <div className="border-border bg-card/60 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border p-4 backdrop-blur">
            {nav}
          </div>
        ) : null}
      </div>
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        {nav}
      </aside>
    </>
  )
}
