import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Palette, RotateCcw, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import { useAppStore } from '@/stores/app'
import { useActiveHarness } from '@/hooks/useHarnessTheme'
import type { HarnessId } from '@superone/shared/session-types'
import {
  brandHueToOklch,
  clampBrandHue,
  countOverriddenHues,
  DESIGN_TOKENS,
  HARNESS_DEFAULT_BRAND_HUE,
  HARNESS_DEFAULT_TOKENS,
  listOverriddenHueTokens,
  resolveTokenLCH,
  TOKEN_GROUP,
  type DesignToken,
  type LCH,
  type LCHPartial,
  type TokenGroup,
} from '@superone/shared/harness-brand'
import { LCHEditor } from './LCHEditor'

const HARNESS_LABEL: Record<HarnessId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  acp: 'Others',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  deepseek: 'DeepSeek',
}

const GROUP_LABEL: Record<TokenGroup, string> = {
  surface: 'Surface',
  foreground: 'Foreground',
  accent: 'Accent',
}

const TOKEN_BY_GROUP: Record<TokenGroup, DesignToken[]> = (() => {
  const buckets: Record<TokenGroup, DesignToken[]> = { surface: [], foreground: [], accent: [] }
  for (const token of DESIGN_TOKENS) buckets[TOKEN_GROUP[token]].push(token)
  return buckets
})()

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

type Mode = 'basic' | 'advanced'

export function BrandColorPopover(): React.JSX.Element | null {
  const isLight = useIsLightMode()
  const harness = useActiveHarness()
  const userHue = useAppStore((s) => s.brandHues[harness])
  const overrides = useAppStore((s) => s.tokenOverrides[harness])
  const setBrandHue = useAppStore((s) => s.setBrandHue)
  const setTokenOverride = useAppStore((s) => s.setTokenOverride)
  const resetTokenOverride = useAppStore((s) => s.resetTokenOverride)
  const resetAllTokenOverrides = useAppStore((s) => s.resetAllTokenOverrides)

  const [mode, setMode] = useState<Mode>('basic')
  const [selectedToken, setSelectedToken] = useState<DesignToken>('--background')

  if (!isLight) return null

  const defaultHue = HARNESS_DEFAULT_BRAND_HUE[harness]
  const effective = userHue ?? defaultHue
  const isCustom = userHue !== null && userHue !== defaultHue
  const label = HARNESS_LABEL[harness]
  const overriddenHueCount = countOverriddenHues(overrides)
  const overriddenHueTokens = listOverriddenHueTokens(overrides)

  const handleHueChange = (raw: number) => {
    const safe = clampBrandHue(raw)
    setBrandHue(harness, safe === defaultHue ? null : safe)
  }

  return (
    <Popover onOpenChange={(open) => { if (!open) setMode('basic') }}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <IconButton size="sm" aria-label={`Customize ${label} color`}>
                <Palette />
              </IconButton>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Customize {label} color</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="start" className="w-80 p-3">
        {mode === 'basic' ? (
          <BasicMode
            label={label}
            effective={effective}
            isCustom={isCustom}
            overriddenHueCount={overriddenHueCount}
            overriddenHueTokens={overriddenHueTokens}
            onHueChange={handleHueChange}
            onReset={() => setBrandHue(harness, null)}
            onAdvanced={() => setMode('advanced')}
          />
        ) : (
          <AdvancedMode
            harness={harness}
            label={label}
            userHue={userHue}
            overrides={overrides}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            onTokenChange={(partial) => void setTokenOverride(harness, selectedToken, partial)}
            onResetToken={(token) => void resetTokenOverride(harness, token)}
            onResetAll={() => void resetAllTokenOverrides(harness)}
            onBack={() => setMode('basic')}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

interface BasicModeProps {
  label: string
  effective: number
  isCustom: boolean
  overriddenHueCount: number
  overriddenHueTokens: DesignToken[]
  onHueChange: (h: number) => void
  onReset: () => void
  onAdvanced: () => void
}

function BasicMode({
  label,
  effective,
  isCustom,
  overriddenHueCount,
  overriddenHueTokens,
  onHueChange,
  onReset,
  onAdvanced,
}: BasicModeProps) {
  return (
    <>
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
            onChange={(e) => onHueChange(Number(e.target.value))}
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

      {overriddenHueCount > 0 && (
        <p
          className="mt-2 text-[11px] text-amber-600 dark:text-amber-400"
          title={overriddenHueTokens.join(', ')}
        >
          ⓘ {overriddenHueCount} token{overriddenHueCount === 1 ? '' : 's'} have custom hue (won't follow this slider)
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAdvanced}
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3" />
          Advanced
        </Button>
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-muted-foreground">
            Light mode only
          </p>
          {isCustom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              Reset
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

interface AdvancedModeProps {
  harness: HarnessId
  label: string
  userHue: number | null
  overrides: Record<string, unknown>
  selectedToken: DesignToken
  onSelectToken: (token: DesignToken) => void
  onTokenChange: (partial: LCHPartial) => void
  onResetToken: (token: DesignToken) => void
  onResetAll: () => void
  onBack: () => void
}

function AdvancedMode({
  harness,
  label,
  userHue,
  overrides,
  selectedToken,
  onSelectToken,
  onTokenChange,
  onResetToken,
  onResetAll,
  onBack,
}: AdvancedModeProps) {
  const currentLCH: LCH = useMemo(
    () => resolveTokenLCH(harness, selectedToken, overrides[selectedToken] as LCH | undefined, userHue),
    [harness, selectedToken, overrides, userHue],
  )

  const defaultLCH = HARNESS_DEFAULT_TOKENS[harness][selectedToken]
  const isOverridden = selectedToken in overrides
  const overrideCount = Object.keys(overrides).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 -ml-2 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back
        </Button>
        <span className="text-[11px] text-muted-foreground">{label} · advanced</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Token
        </span>
        <Select value={selectedToken} onValueChange={(v) => onSelectToken(v as DesignToken)}>
          <SelectTrigger size="sm" className="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TOKEN_BY_GROUP) as TokenGroup[]).map((group) => (
              <SelectGroup key={group}>
                <SelectLabel>{GROUP_LABEL[group]}</SelectLabel>
                {TOKEN_BY_GROUP[group].map((token) => (
                  <SelectItem key={token} value={token} className="font-mono text-xs">
                    {token}{token in overrides ? ' ●' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <LCHEditor lch={currentLCH} onChange={onTokenChange} />

      <div className="flex h-7 items-center justify-between border-t border-border pt-2">
        <p className="text-[10px] text-muted-foreground font-mono">
          default: {defaultLCH.l.toFixed(2)} {defaultLCH.c.toFixed(3)} {defaultLCH.h.toFixed(0)}°
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onResetToken(selectedToken)}
          aria-hidden={!isOverridden}
          tabIndex={isOverridden ? 0 : -1}
          className={cn(
            'h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground',
            !isOverridden && 'invisible',
          )}
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      </div>

      <div className="flex h-7 items-center justify-between border-t border-border pt-2">
        <p className="text-[11px] text-muted-foreground">
          {overrideCount > 0 ? `${overrideCount} customized` : 'No customizations'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetAll}
          aria-hidden={overrideCount === 0}
          tabIndex={overrideCount > 0 ? 0 : -1}
          className={cn(
            'h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive',
            overrideCount === 0 && 'invisible',
          )}
        >
          <RotateCcw className="size-3" />
          Reset all
        </Button>
      </div>
    </div>
  )
}
