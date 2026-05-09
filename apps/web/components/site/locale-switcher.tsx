"use client"

import { useTransition } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Languages } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superone/ui/components/ui/select"
import { usePathname, useRouter } from "@/i18n/navigation"
import { routing, type Locale } from "@/i18n/routing"

export function LocaleSwitcher() {
  const t = useTranslations("Locale")
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  function handleChange(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as Locale })
    })
  }

  return (
    <Select value={locale} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger
        size="sm"
        aria-label={t("label")}
        className="gap-1.5 [&_svg:not([class*='size-'])]:size-3.5"
      >
        <Languages />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {routing.locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {t(loc)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
