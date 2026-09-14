import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { formatBytes } from '@superone/shared/format-bytes'
import type { SyncZoneUsage } from '@superone/shared/environment'

type Usage =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; usage: SyncZoneUsage }

/**
 * What the session sync zone holds, and the one lever a person has over it.
 *
 * There is no cap on the zone by design (`docs/design/session-sync-zone.md`
 * §7): a session's artifacts are named by its transcript, so the only safe
 * deletion is a directory whose session is *known* to be gone, and the sweep
 * that finds those already runs on its own. What a person can want is to see
 * the number and to run that sweep now rather than at the next launch — so
 * this section shows the number and offers the sweep, and nothing that would
 * delete on a guess.
 *
 * Self-contained like `NotificationSettingsSection`: reads its own numbers,
 * re-reads them after a sweep, keeps `AppSettingsPage` a layout file.
 */
export function SessionStorageSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<Usage>({ status: 'loading' })
  const [reclaiming, setReclaiming] = useState(false)
  const [freed, setFreed] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const usage = await window.app.getSyncZoneUsage()
      setState({ status: 'ready', usage })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void load().then(() => { if (!mounted) setState({ status: 'loading' }) })
    return () => { mounted = false }
  }, [load])

  async function reclaim() {
    setReclaiming(true)
    setFreed(null)
    try {
      const result = await window.app.reclaimSyncZone()
      setFreed(result.freedBytes)
      await load()
    } catch {
      setState({ status: 'error' })
    } finally {
      setReclaiming(false)
    }
  }

  const usage = state.status === 'ready' ? state.usage : null
  const reclaimable = usage != null && usage.reclaimable.bytes > 0

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2">
        <p className="text-xs font-medium text-muted-foreground">{t('settings.general.storage.section')}</p>
      </div>

      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.general.storage.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.general.storage.description')}</p>
          <div className="mt-2 space-y-0.5 text-xs" data-testid="session-storage-figures">
            {state.status === 'loading' && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
            )}
            {state.status === 'error' && (
              <p className="text-destructive">{t('settings.general.storage.unreadable')}</p>
            )}
            {usage && (
              <>
                <p>{t('settings.general.storage.summary', { total: formatBytes(usage.totalBytes), count: usage.sessionCount })}</p>
                {usage.pendingBytes > 0 && (
                  <p className="text-muted-foreground">{t('settings.general.storage.pending', { bytes: formatBytes(usage.pendingBytes) })}</p>
                )}
                <p className="text-muted-foreground">
                  {reclaimable
                    ? t('settings.general.storage.reclaimable', { bytes: formatBytes(usage.reclaimable.bytes), count: usage.reclaimable.sessions })
                    : t('settings.general.storage.nothingReclaimable')}
                </p>
                {freed != null && (
                  <p className="text-foreground">
                    {freed > 0 ? t('settings.general.storage.freed', { bytes: formatBytes(freed) }) : t('settings.general.storage.freedNothing')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={usage == null}
            onClick={() => usage && void window.app.revealFile(usage.root)}
          >
            <FolderOpen className="size-3.5" />
            {t('settings.general.storage.reveal')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!reclaimable || reclaiming}
            onClick={() => void reclaim()}
          >
            {reclaiming ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t(reclaiming ? 'settings.general.storage.reclaiming' : 'settings.general.storage.reclaim')}
          </Button>
        </div>
      </div>
    </div>
  )
}
