import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { SettingsRow } from './settings/SettingsSection'

/** User-only opt-in; Cursor does not expose its team MCP policy to the host. */
export function CursorMcpAppsCompatSetting({ enabled, disabled, onChange }: {
  enabled: boolean
  disabled?: boolean
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const descriptionId = useId()
  return (
    <SettingsRow
      label={t('settings.harnesses.cursor.mcpAppsCompatTitle')}
      description={<span id={descriptionId}>{t('settings.harnesses.cursor.mcpAppsCompatDescription')}</span>}
    >
      <Switch
        checked={enabled}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={t('settings.harnesses.cursor.mcpAppsCompatTitle')}
        aria-describedby={descriptionId}
      />
    </SettingsRow>
  )
}
