import { useTranslation } from 'react-i18next'
import { EditorSettingsSection } from '@/components/settings/EditorSettingsSection'
import { LanguageServerSettingsSection } from '@/components/settings/LanguageServerSettingsSection'
import { SettingsPage } from '@/components/settings/SettingsSection'

export function EditorSettingsPage() {
  const { t } = useTranslation()

  return (
    <SettingsPage title={t('settings.editor.title')}>
      <EditorSettingsSection />
      <LanguageServerSettingsSection />
    </SettingsPage>
  )
}
