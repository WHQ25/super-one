import { useEffect, useState } from 'react'
import { Palette, RotateCcw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/stores/app'
import { useActiveHarness } from '@/hooks/useHarnessTheme'
import type { HarnessId } from '../../../../shared/session-types'
import { brandHueToOklch, clampBrandHue, HARNESS_DEFAULT_BRAND_HUE } from '../../../../shared/harness-brand'

const HARNESS_LABEL: Record<HarnessId, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

const HUE_GRADIENT = (() => {
  const stops: string[] = []
  for (let h = 0; h <= 360; h += 30) stops.push(brandHueToOklch(h))
  return `linear-gradient(to right, ${stops.join(', ')})`
})()

function readDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

function useIsLightMode(): boolean {
  const [light, setLight] = useState<boolean>(() => !readDarkClass())
  useEffect(() => {
    const observer = new MutationObserver(() => setLight(!readDarkClass()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return light
}

export function BrandColorPopover(): React.JSX.Element | null {
  const isLight = useIsLightMode()
  const harness = useActiveHarness()
  const userHue = useAppStore((s) => s.brandHues[harness])
  const setBrandHue = useAppStore((s) => s.setBrandHue)

  if (!isLight) return null

  const defaultHue = HARNESS_DEFAULT_BRAND_HUE[harness]
  const effective = userHue ?? defaultHue
  const isCustom = userHue !== null && userHue !== defaultHue
  const label = HARNESS_LABEL[harness]

  const handleChange = (raw: number) => {
    const safe = clampBrandHue(raw)
    setBrandHue(harness, safe === defaultHue ? null : safe)
  }

  return (
    <Popover>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label={`Customize ${label} color`}
              >
                <Palette className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Customize {label} color</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="start" className="w-72 p-3">
        <p className="mb-3 text-xs font-medium">
          Customize {label} color
        </p>

        <div className="flex items-center gap-2">
          <div
            className="relative h-6 flex-1 overflow-hidden rounded-full ring-1 ring-border"
            style={{ background: HUE_GRADIENT }}
          >
            <input
              type="range"
              min={0}
              max={360}
              value={effective}
              onChange={(e) => handleChange(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent
                         [&::-moz-range-thumb]:size-5
                         [&::-moz-range-thumb]:cursor-grab
                         [&::-moz-range-thumb]:rounded-full
                         [&::-moz-range-thumb]:border-0
                         [&::-moz-range-thumb]:bg-white
                         [&::-moz-range-thumb]:shadow
                         [&::-webkit-slider-thumb]:size-5
                         [&::-webkit-slider-thumb]:cursor-grab
                         [&::-webkit-slider-thumb]:appearance-none
                         [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-white
                         [&::-webkit-slider-thumb]:shadow
                         [&::-webkit-slider-thumb]:ring-2
                         [&::-webkit-slider-thumb]:ring-foreground/30
                         [&::-webkit-slider-thumb]:active:cursor-grabbing"
              aria-label={`${label} brand hue`}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {effective}°
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            Light mode only
          </p>
          {isCustom && (
            <button
              type="button"
              onClick={() => setBrandHue(harness, null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
