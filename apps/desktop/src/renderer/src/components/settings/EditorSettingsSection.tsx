import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { useAppStore } from '@/stores/app'
import { SettingsRow, SettingsSection } from './SettingsSection'

export function EditorSettingsSection() {
  const { t } = useTranslation()
  const editorVimMode = useAppStore((s) => s.editorVimMode)
  const setEditorVimMode = useAppStore((s) => s.setEditorVimMode)
  const editorRelativeLineNumbers = useAppStore((s) => s.editorRelativeLineNumbers)
  const setEditorRelativeLineNumbers = useAppStore((s) => s.setEditorRelativeLineNumbers)

  async function handleVimToggle(enabled: boolean) {
    await setEditorVimMode(enabled)
    toast.success(
      t(enabled ? 'settings.general.editorVimMode.enabled' : 'settings.general.editorVimMode.disabled'),
    )
  }

  async function handleRelativeLineNumbersToggle(enabled: boolean) {
    await setEditorRelativeLineNumbers(enabled)
    toast.success(
      t(
        enabled
          ? 'settings.general.editorRelativeLineNumbers.enabled'
          : 'settings.general.editorRelativeLineNumbers.disabled',
      ),
    )
  }

  return (
    <SettingsSection title={t('settings.general.editor')}>
      <SettingsRow
        label={t('settings.general.editorVimMode.label')}
        description={t('settings.general.editorVimMode.description')}
      >
        <Switch
          aria-label={t('settings.general.editorVimMode.label')}
          checked={editorVimMode}
          onCheckedChange={(v) => void handleVimToggle(v)}
        />
      </SettingsRow>
      <SettingsRow
        label={t('settings.general.editorRelativeLineNumbers.label')}
        description={t('settings.general.editorRelativeLineNumbers.description')}
      >
        <Switch
          aria-label={t('settings.general.editorRelativeLineNumbers.label')}
          checked={editorRelativeLineNumbers}
          onCheckedChange={(v) => void handleRelativeLineNumbersToggle(v)}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
