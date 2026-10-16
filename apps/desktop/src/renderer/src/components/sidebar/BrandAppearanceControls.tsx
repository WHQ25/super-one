import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@superone/ui/components/ui/label'
import { Switch } from '@superone/ui/components/ui/switch'
import { ThemeModeCards } from '@/components/settings/ThemeModeCards'
import { useTheme } from '@/hooks/useTheme'
import { useAppStore } from '@/stores/app'

export function BrandAppearanceControls(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useTheme()
  const liquidGlass = useAppStore(s => s.liquidGlass)
  const setLiquidGlass = useAppStore(s => s.setLiquidGlass)
  const glassId = useId()

  return (
    <div className="mb-3 flex flex-col gap-3 border-b border-border pb-3">
      <ThemeModeCards
        value={mode}
        onChange={setMode}
        labelFor={value => t(`settings.appearance.theme.${value}`)}
        className="gap-1"
      />
      {window.app.supportsLiquidGlass && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={glassId} className="text-xs">
            {t('settings.general.liquidGlass.label')}
          </Label>
          <Switch id={glassId} size="sm" checked={liquidGlass} onCheckedChange={setLiquidGlass} />
        </div>
      )}
    </div>
  )
}
