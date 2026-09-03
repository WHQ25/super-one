import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@superone/ui/components/ui/switch'

/**
 * Onboarding row that spends the macOS notification prompt on purpose.
 *
 * macOS only asks the first time an app actually posts, and Electron gives no
 * way to request it earlier. Left alone that lands mid-task, when a prompt gets
 * dismissed reflexively — and a denial is then invisible to us, because Electron
 * reports no authorization status for notifications. Settings would go on
 * claiming the feature is on while nothing could ever arrive.
 *
 * So the switch is the trigger: turning it on posts the first banner right
 * here, with the hint below explaining what macOS is about to ask.
 *
 * What it reflects is "notifications are set up" (`notificationsPrimedAt`), not
 * the `notifications.enabled` preference — that one defaults to true, so a
 * switch bound to it would already be on and there would be nothing to click.
 */
export function OnboardingNotifications(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [primed, setPrimed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const isMac = window.app.platform === 'darwin'

  useEffect(() => {
    if (!isMac) return
    let mounted = true
    void window.app.getAppSettings().then((settings) => {
      if (mounted) setPrimed(settings.notificationsPrimedAt != null)
    })
    return () => {
      mounted = false
    }
  }, [isMac])

  // Windows and Linux have no prompt to spend, and notifications are already on
  // by default — a switch there would be a control with nothing behind it.
  if (!isMac) return null

  async function toggle(next: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    // Optimistic: the macOS prompt steals focus, and a switch that only moves
    // after it is dismissed reads as an unresponsive click.
    setPrimed(next)
    try {
      if (next) {
        await window.app.saveAppSettings({
          notifications: { enabled: true },
          notificationsPrimedAt: Date.now(),
        })
        await window.app.primeNotificationPermission()
      } else {
        await window.app.saveAppSettings({
          notifications: { enabled: false },
          notificationsPrimedAt: null,
        })
      }
    } catch {
      setPrimed(!next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Bell className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('shell.onboarding.notifications.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('shell.onboarding.notifications.description')}
            </p>
          </div>
        </div>
        <Switch
          checked={primed === true}
          onCheckedChange={(next) => void toggle(next)}
          disabled={primed === null || busy}
        />
      </div>

      <AnimatePresence initial={false}>
        {primed === true && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden px-1 pt-2 text-xs text-muted-foreground"
          >
            {t('shell.onboarding.notifications.allowHint')}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
