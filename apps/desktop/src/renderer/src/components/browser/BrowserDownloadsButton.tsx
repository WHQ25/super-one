import { useState } from 'react'
import { ArrowDown, ExternalLink, File, FolderOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BrowserDownloadItem } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useBrowserDownloadsStore } from '@/stores/browser-downloads'

const RING_RADIUS = 7
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

function progressPercent(received: number, total: number): number | null {
  if (total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)))
}

function DownloadRingIcon({
  progressing,
  determinateRatio,
  hasUnseenCompletion,
}: {
  progressing: boolean
  determinateRatio: number | null
  hasUnseenCompletion: boolean
}) {
  if (!progressing) {
    return (
      <span className="relative inline-flex items-center justify-center">
        <ArrowDown className="size-4" />
        {hasUnseenCompletion && (
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
        )}
      </span>
    )
  }

  const dashOffset = determinateRatio !== null
    ? RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, determinateRatio)))
    : RING_CIRCUMFERENCE * 0.7

  return (
    <span className="relative inline-flex size-[18px] items-center justify-center">
      <svg
        viewBox="0 0 18 18"
        className={cn('size-[18px] -rotate-90', determinateRatio === null && 'animate-spin')}
        aria-hidden="true"
      >
        <circle
          cx="9"
          cy="9"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className="text-muted-foreground/25"
        />
        <circle
          cx="9"
          cy="9"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className="text-primary transition-[stroke-dashoffset] duration-150"
        />
      </svg>
      <ArrowDown className="absolute size-3 text-primary" />
    </span>
  )
}

function DownloadRow({
  item,
  onCancel,
  onOpen,
  onShowInFolder,
  onClear,
}: {
  item: BrowserDownloadItem
  onCancel: (id: string) => void
  onOpen: (path: string) => void
  onShowInFolder: (path: string) => void
  onClear: (id: string) => void
}) {
  const { t } = useTranslation()
  const pct = progressPercent(item.receivedBytes, item.totalBytes)
  const isProgressing = item.state === 'progressing'
  const isCompleted = item.state === 'completed'
  const isFailed = item.state === 'interrupted'

  const statusText = (() => {
    if (isProgressing) {
      if (item.totalBytes > 0) {
        return `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)} · ${pct}%`
      }
      return formatBytes(item.receivedBytes)
    }
    if (isCompleted) {
      return `${formatBytes(item.receivedBytes)} · ${t('chat.browser.downloadCompleted')}`
    }
    if (item.state === 'cancelled') {
      return t('chat.browser.downloadCancelled')
    }
    return t('chat.browser.downloadFailed')
  })()

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground',
          isProgressing && 'bg-primary/10 text-primary',
          isFailed && 'bg-destructive/10 text-destructive',
        )}
      >
        <File className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground" title={item.filename}>
          {item.filename}
        </div>
        <div
          className={cn(
            'mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground',
            isFailed && 'text-destructive',
          )}
        >
          {statusText}
        </div>
        {isProgressing && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-[width] duration-150',
                pct === null && 'w-1/2 animate-pulse',
              )}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isProgressing ? (
          <IconButton
            size="xs"
            variant="ghost"
            tooltip={t('chat.browser.downloadCancel')}
            aria-label={t('chat.browser.downloadCancel')}
            onClick={() => onCancel(item.id)}
          >
            <X className="size-3.5" />
          </IconButton>
        ) : (
          <>
            {isCompleted && item.path && (
              <>
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip={t('chat.browser.downloadOpen')}
                  aria-label={t('chat.browser.downloadOpen')}
                  onClick={() => onOpen(item.path)}
                >
                  <ExternalLink className="size-3.5" />
                </IconButton>
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip={t('chat.browser.downloadShowInFolder')}
                  aria-label={t('chat.browser.downloadShowInFolder')}
                  onClick={() => onShowInFolder(item.path)}
                >
                  <FolderOpen className="size-3.5" />
                </IconButton>
              </>
            )}
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('chat.browser.downloadsClearItem')}
              aria-label={t('chat.browser.downloadsClearItem')}
              onClick={() => onClear(item.id)}
            >
              <X className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}

export function BrowserDownloadsButton() {
  const { t } = useTranslation()
  const items = useBrowserDownloadsStore((s) => s.items)
  const hasUnseenCompletion = useBrowserDownloadsStore((s) => s.hasUnseenCompletion)
  const markSeen = useBrowserDownloadsStore((s) => s.markSeen)
  const cancel = useBrowserDownloadsStore((s) => s.cancel)
  const openFile = useBrowserDownloadsStore((s) => s.open)
  const showInFolder = useBrowserDownloadsStore((s) => s.showInFolder)
  const clear = useBrowserDownloadsStore((s) => s.clear)

  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  const activeItems = items.filter((item) => item.state === 'progressing')
  const hasClearable = items.some((item) => item.state !== 'progressing')

  const knownTotals = activeItems.filter((item) => item.totalBytes > 0)
  let determinateRatio: number | null = null
  if (activeItems.length > 0 && knownTotals.length === activeItems.length) {
    const receivedSum = knownTotals.reduce((sum, item) => sum + item.receivedBytes, 0)
    const totalSum = knownTotals.reduce((sum, item) => sum + item.totalBytes, 0)
    determinateRatio = totalSum > 0 ? receivedSum / totalSum : null
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) markSeen()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          tooltip={t('chat.browser.downloads')}
          aria-label={t('chat.browser.downloads')}
        >
          <DownloadRingIcon
            progressing={activeItems.length > 0}
            determinateRatio={determinateRatio}
            hasUnseenCompletion={hasUnseenCompletion}
          />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <span>{t('chat.browser.downloads')}</span>
            {activeItems.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
                {activeItems.length}
              </span>
            )}
          </div>
          {hasClearable && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void clear()}
            >
              {t('chat.browser.downloadsClear')}
            </Button>
          )}
        </div>
        <div className="max-h-72 divide-y divide-border/50 overflow-y-auto">
          {items.map((item) => (
            <DownloadRow
              key={item.id}
              item={item}
              onCancel={(id) => void cancel(id)}
              onOpen={(filePath) => void openFile(filePath)}
              onShowInFolder={(filePath) => void showInFolder(filePath)}
              onClear={(id) => void clear(id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
