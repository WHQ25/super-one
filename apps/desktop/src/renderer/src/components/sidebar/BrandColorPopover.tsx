import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useActiveHarness, useDarkClass } from '@/hooks/useHarnessTheme'
import type { HarnessId } from '@superone/shared/session-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import {
  brandHueToOklch,
  clampBrandHue,
  countOverriddenHues,
  DESIGN_TOKENS,
  DARK_DESIGN_TOKENS,
  DEFAULT_DARK_PRIMARY,
  HARNESS_DEFAULT_BRAND_HUE,
  HARNESS_DEFAULT_TOKENS,
  listOverriddenHueTokens,
  resolveTokenLCH,
  resolveDarkPrimary,
  TOKEN_GROUP,
  type DesignToken,
  type LCH,
  type LCHPartial,
  type TokenGroup,
  type TokenOverrides,
} from '@superone/shared/harness-brand'
import { LCHEditor } from './LCHEditor'
import { BrandAppearanceControls } from './BrandAppearanceControls'

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

type Mode = 'basic' | 'advanced'

export function BrandColorPopover(): React.JSX.Element {
  const { t } = useTranslation()
  const dark = useDarkClass()
  const scheme = dark ? 'dark' : 'light'
  const harness = useActiveHarness()
  const userHue = useAppStore((s) => (dark ? s.darkBrandHues : s.brandHues)[harness])
  const overrides = useAppStore((s) => (dark ? s.darkTokenOverrides : s.tokenOverrides)[harness])
  const setBrandHue = useAppStore((s) => s.setBrandHue)
  const setTokenOverride = useAppStore((s) => s.setTokenOverride)
  const resetTokenOverride = useAppStore((s) => s.resetTokenOverride)
  const resetAllTokenOverrides = useAppStore((s) => s.resetAllTokenOverrides)

  const [mode, setMode] = useState<Mode>('basic')
  const [selectedToken, setSelectedToken] = useState<DesignToken>('--background')
  const activeToken = dark ? '--primary' : selectedToken

  const defaultHue = dark ? DEFAULT_DARK_PRIMARY.h : HARNESS_DEFAULT_BRAND_HUE[harness]
  const effective = userHue ?? defaultHue
  const isCustom = userHue !== null && userHue !== defaultHue
  const label = HARNESS_CAPABILITIES[harness].displayName
  const overriddenHueCount = countOverriddenHues(overrides)
  const overriddenHueTokens = listOverriddenHueTokens(overrides)
  const title = t('settings.appearance.palette.customize', { harness: label })

  const handleHueChange = (raw: number) => {
    const safe = clampBrandHue(raw)
    void setBrandHue(harness, safe === defaultHue ? null : safe, scheme)
  }

  return (
    <Popover onOpenChange={(open) => { if (!open) setMode('basic') }}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <IconButton size="sm" aria-label={title}>
                <Palette />
              </IconButton>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>{title}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="start" className="w-80 p-3">
        {mode === 'basic' ? (
          <>
            <BrandAppearanceControls />
            <BasicMode
              label={label}
              effective={effective}
              isCustom={isCustom}
              dark={dark}
              overriddenHueCount={overriddenHueCount}
              overriddenHueTokens={overriddenHueTokens}
              onHueChange={handleHueChange}
              onReset={() => void setBrandHue(harness, null, scheme)}
              onAdvanced={() => setMode('advanced')}
            />
          </>
        ) : (
          <AdvancedMode
            harness={harness}
            dark={dark}
            label={label}
            userHue={userHue}
            overrides={overrides}
            selectedToken={activeToken}
            onSelectToken={setSelectedToken}
            onTokenChange={(partial) => void setTokenOverride(harness, activeToken, partial, scheme)}
            onResetToken={(token) => void resetTokenOverride(harness, token, scheme)}
            onResetAll={() => void resetAllTokenOverrides(harness, scheme)}
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
  dark: boolean
  overriddenHueCount: number
  overriddenHueTokens: DesignToken[]
  onHueChange: (h: number) => void
  onReset: () => void
  onAdvanced?: () => void
}

function BasicMode({
  label,
  effective,
  isCustom,
  dark,
  overriddenHueCount,
  overriddenHueTokens,
  onHueChange,
  onReset,
  onAdvanced,
}: BasicModeProps) {
  const { t } = useTranslation()
  return (
    <>
      <p className="mb-3 text-xs font-medium">
        {t('settings.appearance.palette.customize', { harness: label })}
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
            aria-label={t('settings.appearance.palette.hue', { harness: label })}
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
          {t('settings.appearance.palette.overriddenHues', { count: overriddenHueCount })}
        </p>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex h-7 items-center gap-2">
          {onAdvanced && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAdvanced}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="size-3" />
              {t('settings.appearance.palette.advanced')}
            </Button>
          )}
          <p className={cn('min-w-0 flex-1 truncate text-[11px] text-muted-foreground', onAdvanced && 'text-right')}>
            {t(`settings.appearance.palette.${dark ? 'darkPalette' : 'lightPalette'}`)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!isCustom}
            aria-hidden={!isCustom}
            tabIndex={isCustom ? 0 : -1}
            className={cn('h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground', !isCustom && 'invisible')}
          >
            <RotateCcw className="size-3" />
            {t('settings.appearance.palette.reset')}
          </Button>
        </div>
      </div>
    </>
  )
}

interface AdvancedModeProps {
  harness: HarnessId
  dark: boolean
  label: string
  userHue: number | null
  overrides: TokenOverrides
  selectedToken: DesignToken
  onSelectToken: (token: DesignToken) => void
  onTokenChange: (partial: LCHPartial) => void
  onResetToken: (token: DesignToken) => void
  onResetAll: () => void
  onBack: () => void
}

function AdvancedMode({
  harness,
  dark,
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
  const { t } = useTranslation()
  const currentLCH: LCH = dark
    ? resolveDarkPrimary(userHue, overrides['--primary'])
    : resolveTokenLCH(harness, selectedToken, overrides[selectedToken], userHue)

  const defaultLCH = dark ? DEFAULT_DARK_PRIMARY : HARNESS_DEFAULT_TOKENS[harness][selectedToken]
  const tokens = dark ? DARK_DESIGN_TOKENS : DESIGN_TOKENS
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
          {t('common.back')}
        </Button>
        <span className="text-[11px] text-muted-foreground">{label} · {t('settings.appearance.palette.advanced')}</span>
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
            {(Object.keys(TOKEN_BY_GROUP) as TokenGroup[]).filter(group => TOKEN_BY_GROUP[group].some(token => tokens.includes(token))).map((group) => (
              <SelectGroup key={group}>
                <SelectLabel>{GROUP_LABEL[group]}</SelectLabel>
                {TOKEN_BY_GROUP[group].filter(token => tokens.includes(token)).map((token) => (
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
          {t('settings.appearance.palette.reset')}
        </Button>
      </div>

      <div className="flex h-7 items-center justify-between border-t border-border pt-2">
        <p className="text-[11px] text-muted-foreground">
          {overrideCount > 0
            ? t('settings.appearance.palette.customized', { count: overrideCount })
            : t('settings.appearance.palette.noCustomizations')}
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
          {t('settings.appearance.palette.resetAll')}
        </Button>
      </div>
    </div>
  )
}
