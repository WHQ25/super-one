import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { formatBytes } from '@superone/shared/format-bytes'
import type { SyncZoneUsage } from '@superone/shared/environment'
import { SettingsRow, SettingsSection } from './SettingsSection'

type Usage =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; usage: SyncZoneUsage }

/**
 * One settings row: label and figures on the left, at most one action on the
 * right — the same shape as every other row in `AppSettingsPage`.
 */
function Row({ label, description, action, children }: {
  label: string
  description?: string
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <SettingsRow
      label={label}
      description={(description || children) && (
        <>
          {description}
          {children && <div className={cn('space-y-0.5 text-foreground', description && 'mt-1.5')}>{children}</div>}
        </>
      )}
    >
      {action}
    </SettingsRow>
  )
}

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
  const [retrying, setRetrying] = useState(false)
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

  /**
   * Files that are complete but never reached the job table have no worker
   * coming for them, so unlike everything else here they need a person. The
   * row appears only when there is something to report.
   */
  async function retryHandoffs() {
    setRetrying(true)
    try {
      await window.app.retrySyncZoneHandoffs()
      await load()
    } catch {
      setState({ status: 'error' })
    } finally {
      setRetrying(false)
    }
  }

  const usage = state.status === 'ready' ? state.usage : null
  const reclaimable = usage != null && usage.reclaimable.bytes > 0
  const stuck = usage != null && usage.failedHandoffs.files > 0
  const needsRedelivery = usage != null && usage.needsRedelivery.files > 0

  return (
    <SettingsSection title={t('settings.general.storage.section')}>

      <Row
        label={t('settings.general.storage.label')}
        description={t('settings.general.storage.description')}
        action={(
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={usage == null}
            onClick={() => usage && void window.app.revealFile(usage.root)}
          >
            <FolderOpen className="size-3.5" />
            {t('settings.general.storage.reveal')}
          </Button>
        )}
      >
        <div data-testid="session-storage-figures">
          {state.status === 'loading' && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          )}
          {state.status === 'error' && (
            <p className="text-destructive">{t('settings.general.storage.unreadable')}</p>
          )}
          {usage && (
            <p>
              {t('settings.general.storage.summary', { total: formatBytes(usage.totalBytes), count: usage.sessionCount })}
              {usage.pendingBytes > 0 && (
                <span className="text-muted-foreground">
                  {' · '}
                  {t('settings.general.storage.pending', { bytes: formatBytes(usage.pendingBytes) })}
                </span>
              )}
            </p>
          )}
        </div>
      </Row>

      {usage && (stuck || needsRedelivery) && (
        <Row
          label={t('settings.general.storage.uploadLabel')}
          action={stuck && (
            <Button variant="outline" size="sm" className="h-7" onClick={() => void retryHandoffs()} disabled={retrying}>
              {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t(retrying ? 'settings.general.storage.retrying' : 'settings.general.storage.stuckRetry')}
            </Button>
          )}
        >
          {stuck && (
            <p className="text-warning" data-testid="session-storage-stuck">
              {t('settings.general.storage.stuck', {
                bytes: formatBytes(usage.failedHandoffs.bytes),
                count: usage.failedHandoffs.files,
                error: usage.failedHandoffs.lastError ?? '',
              })}
            </p>
          )}
          {needsRedelivery && (
            <p className="text-warning" data-testid="session-storage-needs-redelivery">
              {t('settings.general.storage.needsRedelivery', {
                bytes: formatBytes(usage.needsRedelivery.bytes),
                count: usage.needsRedelivery.files,
              })}
            </p>
          )}
        </Row>
      )}

      {usage && (
        <Row
          label={t('settings.general.storage.cleanupLabel')}
          description={t('settings.general.storage.cleanupDescription')}
          action={(
            <Button
              variant="outline"
              size="sm"
              disabled={!reclaimable || reclaiming}
              onClick={() => void reclaim()}
            >
              {reclaiming ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              {t(reclaiming ? 'settings.general.storage.reclaiming' : 'settings.general.storage.reclaim')}
            </Button>
          )}
        >
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
        </Row>
      )}
    </SettingsSection>
  )
}
