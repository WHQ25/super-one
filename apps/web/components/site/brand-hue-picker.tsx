"use client"

import { useTheme } from "next-themes"
import { useHydrated } from "@/lib/use-hydrated"
import { useTranslations } from "next-intl"
import { Palette, RotateCcw } from "lucide-react"
import { brandHueToOklch } from "@superone/shared/harness-brand"
import { Button } from "@superone/ui/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@superone/ui/components/ui/popover"
import { useBrandHue, DEFAULT_BRAND_HUE } from "@/components/providers/brand-hue-provider"

const HUE_GRADIENT = (() => {
  const stops: string[] = []
  for (let h = 0; h <= 360; h += 30) stops.push(brandHueToOklch(h))
  return `linear-gradient(to right, ${stops.join(", ")})`
})()

export function BrandHuePicker() {
  const t = useTranslations("BrandHue")
  const { resolvedTheme } = useTheme()
  const { brandHue, setBrandHue, isCustom, reset } = useBrandHue()
  const mounted = useHydrated()

  if (!mounted || resolvedTheme === "dark") return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("label")}
          style={{ color: brandHueToOklch(brandHue) }}
        >
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("label")}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={reset}
            disabled={!isCustom}
            aria-label={t("reset")}
          >
            <RotateCcw />
          </Button>
        </div>

        <div className="relative h-6 rounded-md" style={{ background: HUE_GRADIENT }}>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={brandHue}
            onChange={(e) => setBrandHue(Number(e.target.value))}
            aria-label={t("label")}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:size-5
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-background
              [&::-webkit-slider-thumb]:shadow
              [&::-webkit-slider-thumb]:bg-[var(--thumb-color)]
              [&::-moz-range-thumb]:size-5
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:border-2
              [&::-moz-range-thumb]:border-background
              [&::-moz-range-thumb]:bg-[var(--thumb-color)]"
            style={{ ["--thumb-color" as string]: brandHueToOklch(brandHue) }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span>{Math.round(brandHue)}°</span>
          <span>{isCustom ? "" : `default ${DEFAULT_BRAND_HUE}°`}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
