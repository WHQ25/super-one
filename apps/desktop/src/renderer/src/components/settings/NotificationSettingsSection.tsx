import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Switch } from '@superone/ui/components/ui/switch'
import { NOTIFICATION_KINDS, type NotificationSettings } from '@superone/shared/notifications'

/**
 * Notification preferences: one master switch, with the per-kind opt-out folded
 * away behind it.
 *
 * The per-kind rows are the uncommon case -- every kind defaults on, and the
 * decision most people make is the master one. They also mean nothing while the
 * master is off, so they are not rendered at all rather than rendered dead.
 *
 * Self-contained (reads and saves its own slice) so `AppSettingsPage` stays a
 * layout file. Patches send only the changed key -- `mergeNotificationSettings`
 * in the main process merges `kinds` per-key.
 */
export function NotificationSettingsSection() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [expanded, setExpanded] = useState(false)

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
  // Collapsed, this row is the only thing telling the user whether they have
  // customised anything, so it counts rather than repeating the static blurb.
  const selected = NOTIFICATION_KINDS.filter((kind) => settings?.kinds[kind] !== false).length

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

      {enabled && (
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('settings.general.notifications.kinds.label')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected === NOTIFICATION_KINDS.length
                  ? t('settings.general.notifications.kinds.summaryAll')
                  : t('settings.general.notifications.kinds.summarySome', {
                      selected,
                      total: NOTIFICATION_KINDS.length,
                    })}
              </p>
            </div>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-3 px-4 pb-4">
                  {NOTIFICATION_KINDS.map((kind) => (
                    <div key={kind} className="flex items-center justify-between gap-4">
                      <p className="min-w-0 text-sm">{t(`settings.general.notifications.kinds.${kind}`)}</p>
                      <Switch
                        checked={settings?.kinds[kind] ?? false}
                        onCheckedChange={(next) => void save({ kinds: { [kind]: next } })}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
