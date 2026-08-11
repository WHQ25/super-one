import { Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'

/**
 * Compact auto-update pill living in the sidebar footer row.
 * available -> clickable "Update" (starts download),
 * preparing -> spinner + "Preparing" (electron-updater is fetching blockmaps /
 *   computing the differential plan; no progress events yet, can take seconds),
 * downloading -> download icon + percent (app binary),
 * downloading-harness -> spinner + percent (enabled harness pins for target version),
 * harness-error -> clickable "Retry" (re-run harness pre-fetch only),
 * ready -> clickable "Restart" (app + harness package complete).
 */
export function UpdateStatusIcon(): React.JSX.Element | null {
  const { t } = useTranslation()
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const updateProgress = useAppStore((s) => s.updateProgress)
  const updateHarnessId = useAppStore((s) => s.updateHarnessId)
  const updateErrorMessage = useAppStore((s) => s.updateErrorMessage)
  const downloadUpdate = useAppStore((s) => s.downloadUpdate)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const retryUpdateHarness = useAppStore((s) => s.retryUpdateHarness)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  if (
    updateStatus !== 'available' &&
    updateStatus !== 'preparing' &&
    updateStatus !== 'downloading' &&
    updateStatus !== 'downloading-harness' &&
    updateStatus !== 'harness-error' &&
    updateStatus !== 'ready'
  ) {
    return null
  }

  const version = updateVersion ? `v${updateVersion}` : ''
  const available = updateStatus === 'available'
  const preparing = updateStatus === 'preparing'
  const downloading = updateStatus === 'downloading'
  const downloadingHarness = updateStatus === 'downloading-harness'
  const harnessError = updateStatus === 'harness-error'
  const ready = updateStatus === 'ready'
  const percent = Math.min(100, Math.max(0, Math.round(updateProgress)))
  const interactive = available || ready || harnessError
  const busy = preparing || downloading || downloadingHarness

  const tooltip = ready
    ? t('shell.update.ready', { version: updateVersion })
    : harnessError
      ? t('shell.update.harnessError', {
          version,
          message: updateErrorMessage ?? t('shell.update.harnessFailed'),
        })
      : downloadingHarness
        ? t('shell.update.downloadingHarnessWithProgress', {
            version,
            progress: percent,
            harness: updateHarnessId || '…',
          })
        : downloading
          ? t('shell.update.downloadingWithProgress', { version, progress: percent })
          : preparing
            ? t('shell.update.preparing', { version })
            : t('shell.update.availableHint', { version })

  const handleClick = (): void => {
    if (ready) {
      if (import.meta.env.DEV) dismissUpdate()
      else installUpdate()
      return
    }
    if (harnessError) {
      retryUpdateHarness()
      return
    }
    if (available) downloadUpdate()
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            className={cn(
              'ml-auto h-4.5 gap-0.5 rounded-full px-1.5 text-[10px] font-medium leading-none',
              !interactive && 'cursor-default',
              harnessError && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
            aria-busy={busy}
            onClick={interactive ? handleClick : undefined}
          >
            {ready ? (
              t('shell.update.restart')
            ) : harnessError ? (
              t('shell.update.retryHarness')
            ) : downloadingHarness ? (
              <>
                <Loader2 className="size-2.5 animate-spin" />
                <span className="tabular-nums">{percent}%</span>
              </>
            ) : downloading ? (
              <>
                <Download className="size-2.5" />
                <span className="tabular-nums">{percent}%</span>
              </>
            ) : preparing ? (
              <>
                <Loader2 className="size-2.5 animate-spin" />
                <span>{t('shell.update.preparingShort')}</span>
              </>
            ) : (
              t('shell.update.available')
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="max-w-xs whitespace-pre-wrap">{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
