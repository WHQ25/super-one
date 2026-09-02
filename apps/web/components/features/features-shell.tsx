import type { ReactNode } from "react"
import { cn } from "@superone/ui/lib/utils"
import type { Locale } from "@/i18n/routing"
import { FeaturesSidebar } from "./features-sidebar"

interface FeaturesShellProps {
  locale: Locale
  toc?: ReactNode
  children: ReactNode
}

export function FeaturesShell({ locale, toc, children }: FeaturesShellProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <div
        className={cn(
          "grid gap-8 lg:gap-10",
          toc
            ? "lg:grid-cols-[220px_minmax(0,1fr)_200px]"
            : "lg:grid-cols-[220px_minmax(0,1fr)]",
        )}
      >
        <FeaturesSidebar locale={locale} />
        <div className="min-w-0">{children}</div>
        {toc ? (
          <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            {toc}
          </aside>
        ) : null}
      </div>
    </main>
  )
}
