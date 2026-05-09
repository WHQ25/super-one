import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { LocaleSwitcher } from "./locale-switcher"
import { ThemeToggle } from "./theme-toggle"
import { BrandHuePicker } from "./brand-hue-picker"

export function SiteHeader() {
  const t = useTranslations("Nav")
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="px-3 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground font-semibold">
            SuperOne
          </Link>
          <Link href="/demos" className="px-3 py-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            {t("demos")}
          </Link>
          <Link href="/docs" className="px-3 py-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            {t("docs")}
          </Link>
        </nav>
        <div className="flex items-center gap-1">
          <BrandHuePicker />
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  )
}
