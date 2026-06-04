import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { applyCrispText } from '@/lib/font-smoothing'
import { processAppIcon } from '@/lib/app-icon-image'
import { listSystemFonts, type SystemFonts } from '@/lib/system-fonts'
import { useAppStore } from '@/stores/app'
import {
  type TerminalScheme,
  TERMINAL_FONT_SIZES,
  DEFAULT_DARK_PALETTE_ID,
  DEFAULT_LIGHT_PALETTE_ID,
  getTerminalPalette,
  terminalPalettesFor,
} from '@/components/coding/terminal-palettes'
import { TerminalThemePreview } from '@/components/coding/TerminalThemePreview'

function FontDropdown({
  value,
  fonts,
  loading,
  systemLabel,
  onOpen,
  onSelect,
}: {
  value: string | null
  fonts: string[]
  loading: boolean
  systemLabel: string
  onOpen: () => void
  onSelect: (family: string | null) => void
}) {
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) onOpen() }}>
      <DropdownMenuTrigger asChild>
        <button className="flex min-w-44 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted">
          <span className="truncate" style={value ? { fontFamily: `"${value}"` } : undefined}>{value ?? systemLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuItem onClick={() => onSelect(null)} className="flex items-center justify-between">
          <span>{systemLabel}</span>
          {value === null && <Check className="size-4 shrink-0 text-muted-foreground" />}
        </DropdownMenuItem>
        {loading && fonts.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">…</div>
        )}
        {fonts.map((family) => (
          <DropdownMenuItem
            key={family}
            onClick={() => onSelect(family)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate" style={{ fontFamily: `"${family}"` }}>{family}</span>
            {value === family && <Check className="size-4 shrink-0 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppearancePage() {
  const { t } = useTranslation()
  const [crispText, setCrispText] = useState(true)
  const [customAppIconPath, setCustomAppIconPath] = useState<string | null>(null)
  const [iconDataUri, setIconDataUri] = useState<string | null>(null)
  const [iconBusy, setIconBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fonts, setFonts] = useState<SystemFonts>({ all: [], monospace: [] })
  const [fontsLoading, setFontsLoading] = useState(false)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const terminalLightPalette = useAppStore((s) => s.terminalLightPalette)
  const terminalDarkPalette = useAppStore((s) => s.terminalDarkPalette)
  const terminalFontSize = useAppStore((s) => s.terminalFontSize)
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const setTerminalPalette = useAppStore((s) => s.setTerminalPalette)
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize)
  const setTerminalFontFamily = useAppStore((s) => s.setTerminalFontFamily)
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily)
  const isMac = window.app.platform === 'darwin'

  const selectedPaletteId: Record<TerminalScheme, string> = {
    light: terminalLightPalette ?? DEFAULT_LIGHT_PALETTE_ID,
    dark: terminalDarkPalette ?? DEFAULT_DARK_PALETTE_ID,
  }

  const loadFonts = useCallback(async () => {
    if (fontsLoaded || fontsLoading) return
    setFontsLoading(true)
    try {
      setFonts(await listSystemFonts())
      setFontsLoaded(true)
      setFontsLoading(false)
    } catch (e) {
      setFontsLoading(false)
      throw e
    }
  }, [fontsLoaded, fontsLoading])

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setCrispText(settings.crispText)
      setCustomAppIconPath(settings.customAppIconPath)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!customAppIconPath) {
      setIconDataUri(null)
      return
    }
    let mounted = true
    window.app.readFileAsDataUri(customAppIconPath).then((result) => {
      if (mounted) setIconDataUri(result.ok ? result.dataUri : null)
    })
    return () => { mounted = false }
  }, [customAppIconPath])

  async function handlePickIcon() {
    if (iconBusy) return
    setIconBusy(true)
    try {
      const filePath = await window.app.pickAppIconFile()
      if (filePath) {
        const read = await window.app.readFileAsDataUri(filePath)
        if (!read.ok) {
          toast.error(read.error)
        } else {
          const processed = await processAppIcon(read.dataUri, isMac)
          const result = await window.app.setAppIcon(processed)
          setCustomAppIconPath(result.customAppIconPath)
          toast.success(t('settings.general.appIcon.updated'))
        }
      }
      setIconBusy(false)
    } catch (e) {
      setIconBusy(false)
      throw e
    }
  }

  async function handleResetIcon() {
    if (iconBusy) return
    setIconBusy(true)
    try {
      const result = await window.app.resetAppIcon()
      setCustomAppIconPath(result.customAppIconPath)
      toast.success(t('settings.general.appIcon.resetDone'))
      setIconBusy(false)
    } catch (e) {
      setIconBusy(false)
      throw e
    }
  }

  async function handleCrispTextToggle(enabled: boolean) {
    applyCrispText(enabled)
    const result = await window.app.saveAppSettings({ crispText: enabled })
    setCrispText(result.crispText)
  }

  const systemFontLabel = t('settings.general.font.systemDefault')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.appearance.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.appearance.subtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.appearance.interface')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.uiFont.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.uiFont.description')}
              </p>
            </div>
            <FontDropdown
              value={uiFontFamily}
              fonts={fonts.all}
              loading={fontsLoading}
              systemLabel={systemFontLabel}
              onOpen={loadFonts}
              onSelect={setUiFontFamily}
            />
          </div>
          {isMac && (
            <div className="flex items-center justify-between gap-4 border-t border-border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.general.crispText.label')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.general.crispText.description')}
                </p>
              </div>
              <Switch
                checked={crispText}
                onCheckedChange={handleCrispTextToggle}
                disabled={loading}
              />
            </div>
          )}
          {import.meta.env.DEV && (
          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.appIcon.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.appIcon.description')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {iconDataUri && (
                <img src={iconDataUri} alt="" className="size-10 object-contain" />
              )}
              {customAppIconPath && (
                <button
                  onClick={handleResetIcon}
                  disabled={loading || iconBusy}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('settings.general.appIcon.reset')}
                </button>
              )}
              <button
                onClick={handlePickIcon}
                disabled={loading || iconBusy}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('settings.general.appIcon.choose')}
              </button>
            </div>
          </div>
          )}
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">{t('settings.general.terminal')}</p>
          </div>
          {(['light', 'dark'] as TerminalScheme[]).map((scheme) => {
            const selected = getTerminalPalette(selectedPaletteId[scheme], scheme)
            return (
              <div key={scheme} className="border-b border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium">
                    {t(scheme === 'light' ? 'settings.general.terminalTheme.light' : 'settings.general.terminalTheme.dark')}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted">
                        <span className="truncate">{selected.name}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {terminalPalettesFor(scheme).map((palette) => (
                        <DropdownMenuItem
                          key={palette.id}
                          onClick={() => setTerminalPalette(scheme, palette.id)}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex size-4 overflow-hidden rounded-sm border border-border">
                              <span className="flex-1" style={{ backgroundColor: palette.ansi.red }} />
                              <span className="flex-1" style={{ backgroundColor: palette.ansi.green }} />
                              <span className="flex-1" style={{ backgroundColor: palette.ansi.blue }} />
                            </span>
                            <span>{palette.name}</span>
                          </span>
                          {selectedPaletteId[scheme] === palette.id && <Check className="size-4 shrink-0 text-muted-foreground" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-3">
                  <TerminalThemePreview ansi={selected.ansi} scheme={scheme} fontSize={terminalFontSize} fontFamily={terminalFontFamily} />
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.terminalFont.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.terminalFont.description')}
              </p>
            </div>
            <FontDropdown
              value={terminalFontFamily}
              fonts={fonts.monospace}
              loading={fontsLoading}
              systemLabel={systemFontLabel}
              onOpen={loadFonts}
              onSelect={setTerminalFontFamily}
            />
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.terminalFontSize.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.general.terminalFontSize.description')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex min-w-32 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted">
                  <span className="truncate">{terminalFontSize}px</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                {TERMINAL_FONT_SIZES.map((size) => (
                  <DropdownMenuItem
                    key={size}
                    onClick={() => setTerminalFontSize(size)}
                    className="flex items-center justify-between"
                  >
                    <span>{size}px</span>
                    {terminalFontSize === size && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
