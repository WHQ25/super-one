import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { AlertTriangle } from 'lucide-react'

/**
 * DeepSeek-harness preferences. One entry today: the self-referential Cordis
 * toolset, an opt-in the user has to make deliberately.
 *
 * It reads and writes `AppSettings` directly rather than through a store,
 * because the whole page is one switch and the main process applies it to the
 * live dsh tree on save — there is no derived renderer state to keep.
 */
export function DshPreferencesPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void window.app.getAppSettings().then((settings) => {
      if (cancelled) return
      setEnabled(settings.dshToolCordis)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-2xl">
      <div className="rounded-lg border border-border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.dsh.toolCordis.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.dsh.toolCordis.description')}
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{t('settings.dsh.toolCordis.warning')}</span>
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={loading}
            onCheckedChange={async (next) => {
              const result = await window.app.saveAppSettings({ dshToolCordis: next })
              setEnabled(result.dshToolCordis)
            }}
          />
        </div>
      </div>
    </div>
  )
}
