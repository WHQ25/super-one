import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'
import { NOTIFICATION_KINDS, type NotificationSettings } from '@superone/shared/notifications'

/**
 * Notification preferences: one master switch plus a per-kind opt-out.
 *
 * Self-contained (reads and saves its own slice) so `AppSettingsPage` stays a
 * layout file, and so a later per-channel row can land here without touching
 * the page. Patches send only the changed key — `mergeNotificationSettings` in
 * the main process merges `kinds` per-key.
 */
export function NotificationSettingsSection() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((s) => {
      if (mounted) setSettings(s.notifications)
    })
    return () => {
      mounted = false
    }
  }, [])

  async function save(patch: { enabled?: boolean; kinds?: Partial<NotificationSettings['kinds']> }) {
    const result = await window.app.saveAppSettings({ notifications: patch })
    setSettings(result.notifications)
  }

  const enabled = settings?.enabled ?? false
  const loading = settings == null

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2">
        <p className="text-xs font-medium text-muted-foreground">{t('settings.general.notifications.section')}</p>
      </div>

      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.general.notifications.enabled.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.general.notifications.enabled.description')}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next) => void save({ enabled: next })}
          disabled={loading}
        />
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">{t('settings.general.notifications.kinds.label')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('settings.general.notifications.kinds.description')}
        </p>
        <div className="mt-3 space-y-3">
          {NOTIFICATION_KINDS.map((kind) => (
            <div key={kind} className="flex items-center justify-between gap-4">
              <p className="min-w-0 text-sm">{t(`settings.general.notifications.kinds.${kind}`)}</p>
              <Switch
                checked={settings?.kinds[kind] ?? false}
                onCheckedChange={(next) => void save({ kinds: { [kind]: next } })}
                // The per-kind switches are meaningless while the master is off.
                disabled={loading || !enabled}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
