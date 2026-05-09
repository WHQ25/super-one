"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { Monitor, Moon, Sun } from "lucide-react"
import { Button } from "@superone/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@superone/ui/components/ui/dropdown-menu"

const ICON: Record<string, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

export function ThemeToggle() {
  const t = useTranslations("Theme")
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const current = mounted ? (theme ?? "system") : "system"
  const Icon = mounted
    ? (current === "system" ? Monitor : (resolvedTheme === "dark" ? Moon : Sun))
    : Monitor

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("label")}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {(["system", "light", "dark"] as const).map((opt) => {
          const OptIcon = ICON[opt]
          return (
            <DropdownMenuItem
              key={opt}
              onClick={() => setTheme(opt)}
              data-active={current === opt}
              className="data-[active=true]:font-medium"
            >
              <OptIcon className="size-4" />
              {t(opt)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
