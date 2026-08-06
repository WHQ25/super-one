import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'

/**
 * Compact auto-update pill living in the sidebar footer row.
 * available -> clickable "Update" (starts download),
 * downloading -> download icon + percent,
 * ready -> clickable "Restart".
 */
export function UpdateStatusIcon(): React.JSX.Element | null {
  const { t } = useTranslation()
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const updateProgress = useAppStore((s) => s.updateProgress)
  const downloadUpdate = useAppStore((s) => s.downloadUpdate)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  if (
    updateStatus !== 'available' &&
    updateStatus !== 'preparing' &&
    updateStatus !== 'downloading' &&
    updateStatus !== 'ready'
  ) {
    return null
  }

  const version = updateVersion ? `v${updateVersion}` : ''
  const available = updateStatus === 'available'
  const ready = updateStatus === 'ready'
  const percent = Math.min(100, Math.max(0, Math.round(updateProgress)))
  const interactive = available || ready

  const tooltip = ready
    ? t('shell.update.ready', { version: updateVersion })
    : updateStatus === 'downloading'
      ? t('shell.update.downloadingWithProgress', { version, progress: percent })
      : updateStatus === 'preparing'
        ? t('shell.update.preparing', { version })
        : t('shell.update.availableHint', { version })

  const handleClick = (): void => {
    if (ready) {
      if (import.meta.env.DEV) dismissUpdate()
      else installUpdate()
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
            )}
            onClick={interactive ? handleClick : undefined}
          >
            {ready ? (
              t('shell.update.restart')
            ) : updateStatus === 'downloading' ? (
              <>
                <Download className="size-2.5" />
                <span className="tabular-nums">{percent}%</span>
              </>
            ) : (
              t('shell.update.available')
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
