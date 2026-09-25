import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
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
import { useTheme } from '@/hooks/useTheme'
import {
  type TerminalScheme,
  TERMINAL_FONT_SIZES,
} from '@/components/coding/terminal-palettes'
import { type MermaidScheme } from '@/components/chat/mermaid-themes'
import { TerminalPalettePicker } from '@/components/settings/TerminalPalettePicker'
import { MermaidThemePicker } from '@/components/settings/MermaidThemePicker'
import { ThemeModeCards } from '@/components/settings/ThemeModeCards'
import { SettingsPage, SettingsRow, SettingsSection, settingsRowClassName } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'

const dropdownTriggerClassName = cn(settingsSelectTriggerClassName, 'min-w-32 justify-between')

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
        <button className={cn(dropdownTriggerClassName, 'min-w-44')}>
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
  const mermaidLightTheme = useAppStore((s) => s.mermaidLightTheme)
  const mermaidDarkTheme = useAppStore((s) => s.mermaidDarkTheme)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const setTerminalPalette = useAppStore((s) => s.setTerminalPalette)
  const setMermaidTheme = useAppStore((s) => s.setMermaidTheme)
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize)
  const setTerminalFontFamily = useAppStore((s) => s.setTerminalFontFamily)
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily)
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const setLiquidGlass = useAppStore((s) => s.setLiquidGlass)
  const autoExpandFileDiffs = useAppStore((s) => s.autoExpandFileDiffs)
  const setAutoExpandFileDiffs = useAppStore((s) => s.setAutoExpandFileDiffs)
  const detailChatMode = useAppStore((s) => s.detailChatMode)
  const setDetailChatMode = useAppStore((s) => s.setDetailChatMode)
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const isMac = window.app.platform === 'darwin'
  const supportsLiquidGlass = window.app.supportsLiquidGlass

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
    <SettingsPage title={t('settings.appearance.title')}>
      <SettingsSection title={t('settings.appearance.theme.label')}>
        <div className="p-2">
          <ThemeModeCards
            value={themeMode}
            onChange={setThemeMode}
            labelFor={(mode) => t(`settings.appearance.theme.${mode}`)}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.appearance.interface')}>
        <SettingsRow
          label={t('settings.general.uiFont.label')}
          description={t('settings.general.uiFont.description')}
        >
          <FontDropdown
            value={uiFontFamily}
            fonts={fonts.all}
            loading={fontsLoading}
            systemLabel={systemFontLabel}
            onOpen={loadFonts}
            onSelect={setUiFontFamily}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.general.autoExpandFileDiffs.label')}
          description={t('settings.general.autoExpandFileDiffs.description')}
        >
          <Switch
            checked={autoExpandFileDiffs}
            onCheckedChange={setAutoExpandFileDiffs}
            disabled={loading}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.general.detailChatMode.label')}
          description={t('settings.general.detailChatMode.description')}
        >
          <Switch
            checked={detailChatMode}
            onCheckedChange={setDetailChatMode}
            disabled={loading}
          />
        </SettingsRow>
        {isMac && (
          <SettingsRow
            label={t('settings.general.crispText.label')}
            description={t('settings.general.crispText.description')}
          >
            <Switch
              checked={crispText}
              onCheckedChange={handleCrispTextToggle}
              disabled={loading}
            />
          </SettingsRow>
        )}
        {supportsLiquidGlass && (
          <SettingsRow
            label={t('settings.general.liquidGlass.label')}
            description={t('settings.general.liquidGlass.description')}
          >
            <Switch
              checked={liquidGlass}
              onCheckedChange={setLiquidGlass}
              disabled={loading}
            />
          </SettingsRow>
        )}
        {import.meta.env.DEV && (
          <SettingsRow
            label={t('settings.general.appIcon.label')}
            description={t('settings.general.appIcon.description')}
          >
            {iconDataUri && (
              <img src={iconDataUri} alt="" className="size-8 object-contain" />
            )}
            {customAppIconPath && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-muted-foreground"
                onClick={handleResetIcon}
                disabled={loading || iconBusy}
              >
                {t('settings.general.appIcon.reset')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={handlePickIcon}
              disabled={loading || iconBusy}
            >
              {t('settings.general.appIcon.choose')}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={t('settings.general.terminal')}>
        {(['light', 'dark'] as TerminalScheme[]).map((scheme) => (
          <div key={scheme} className={settingsRowClassName}>
            <TerminalPalettePicker
              scheme={scheme}
              value={scheme === 'light' ? terminalLightPalette : terminalDarkPalette}
              onChange={(id) => setTerminalPalette(scheme, id)}
              fontSize={terminalFontSize}
              fontFamily={terminalFontFamily}
              label={(
                <p className="text-sm">
                  {t(scheme === 'light' ? 'settings.general.terminalTheme.light' : 'settings.general.terminalTheme.dark')}
                </p>
              )}
            />
          </div>
        ))}
        <SettingsRow
          label={t('settings.general.terminalFont.label')}
          description={t('settings.general.terminalFont.description')}
        >
          <FontDropdown
            value={terminalFontFamily}
            fonts={fonts.monospace}
            loading={fontsLoading}
            systemLabel={systemFontLabel}
            onOpen={loadFonts}
            onSelect={setTerminalFontFamily}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.general.terminalFontSize.label')}
          description={t('settings.general.terminalFontSize.description')}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={dropdownTriggerClassName}>
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.general.mermaid')}>
        {(['light', 'dark'] as MermaidScheme[]).map((scheme) => (
          <div key={scheme} className={settingsRowClassName}>
            <MermaidThemePicker
              scheme={scheme}
              value={scheme === 'light' ? mermaidLightTheme : mermaidDarkTheme}
              onChange={(id) => setMermaidTheme(scheme, id)}
              label={(
                <p className="text-sm">
                  {t(scheme === 'light' ? 'settings.general.mermaidTheme.light' : 'settings.general.mermaidTheme.dark')}
                </p>
              )}
            />
          </div>
        ))}
      </SettingsSection>
    </SettingsPage>
  )
}
