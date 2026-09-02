import Image from "next/image"
import { useTranslations } from "next-intl"
import { Button } from "@superone/ui/components/ui/button"
import { Link } from "@/i18n/navigation"
import { BrandHuePicker } from "./brand-hue-picker"
import { MainNav } from "./main-nav"
import { ThemeToggle } from "./theme-toggle"

export function SiteHeader() {
  const t = useTranslations("Nav")
  return (
    <header className="border-border bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            aria-label="SuperOne"
            className="flex items-center rounded-md px-2 py-1.5"
          >
            <Image
              src="/logo/wordmark.webp"
              alt="SuperOne"
              width={1291}
              height={256}
              priority
              className="h-8 w-auto"
            />
          </Link>
          <MainNav />
        </div>
        <div className="flex items-center gap-2">
          <BrandHuePicker />
          <ThemeToggle />
          <Button
            asChild
            size="lg"
            className="bg-foreground text-background hover:bg-foreground/90 ml-1 rounded-full px-4 text-base font-bold tracking-tight duration-200 hover:scale-105"
          >
            <Link href="/download">{t("download")}</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
