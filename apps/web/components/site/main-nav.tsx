import { ChevronDown } from "lucide-react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"

const RESOURCE_KEYS = ["skills", "mcps", "miniapps", "providers"] as const

export function MainNav() {
  const t = useTranslations("Nav")

  const resources = RESOURCE_KEYS.map((key) => ({
    key,
    title: t(`resourcesItems.${key}.title`),
    desc: t(`resourcesItems.${key}.desc`),
    href: t(`resourcesItems.${key}.href`),
  }))

  return (
    <nav className="hidden items-center gap-1 text-[15px] md:flex">
      <Link
        href="/features"
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-3.5 py-2 transition-colors"
      >
        {t("features")}
      </Link>

      <div className="group relative">
        <button
          type="button"
          aria-haspopup="true"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground group-focus-within:bg-accent group-focus-within:text-accent-foreground inline-flex items-center gap-1 rounded-md px-3.5 py-2 transition-colors"
        >
          {t("resources")}
          <ChevronDown
            aria-hidden
            className="size-4 transition-transform duration-150 group-hover:rotate-180 group-focus-within:rotate-180"
          />
        </button>
        <div
          className="invisible absolute top-full left-1/2 z-50 -translate-x-1/2 pt-2 opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          <div className="border-border bg-popover grid w-[600px] grid-cols-2 gap-1 rounded-xl border p-2.5 shadow-lg">
            {resources.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className="hover:bg-accent flex flex-col gap-1 rounded-lg p-3.5 transition-colors"
              >
                <span className="text-popover-foreground text-[15px] font-medium">
                  {r.title}
                </span>
                <span className="text-muted-foreground text-[13px] leading-relaxed">
                  {r.desc}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <Link
        href="/changelog"
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-3.5 py-2 transition-colors"
      >
        {t("changelog")}
      </Link>
      <Link
        href="/docs"
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-3.5 py-2 transition-colors"
      >
        {t("docs")}
      </Link>
    </nav>
  )
}
