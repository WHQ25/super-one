import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download as DownloadIcon } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import {
  parseListDownloadsResult,
  type BrowserDownloadListItem,
} from './browser-tool-display'

export interface BrowserListDownloadsViewPresenterProps {
  result: string
  renderFile?: (item: BrowserDownloadListItem) => ReactNode
  onSaveFile?: (path: string, filename: string) => Promise<'saved' | 'cancelled' | 'error'>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function downloadStateLabel(state: string | undefined, t: (key: string) => string): string {
  switch (state) {
    case 'completed': return t('chat.toolBlock.browser.downloadStateCompleted')
    case 'progressing': return t('chat.toolBlock.browser.downloadStateProgressing')
    case 'cancelled': return t('chat.toolBlock.browser.downloadStateCancelled')
    case 'interrupted': return t('chat.toolBlock.browser.downloadStateInterrupted')
    default: return state || ''
  }
}

function DownloadListRow({
  item,
  renderFile,
  onSaveFile,
}: {
  item: BrowserDownloadListItem
  renderFile?: BrowserListDownloadsViewPresenterProps['renderFile']
  onSaveFile?: BrowserListDownloadsViewPresenterProps['onSaveFile']
}) {
  const { t } = useTranslation()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const completed = item.state === 'completed' && !!item.path
  const failed = item.state === 'cancelled' || item.state === 'interrupted'
  const inFlight = item.state === 'progressing'
  const urlDisplay = item.url ? item.url.replace(/^https?:\/\//, '') : ''
  const stateLabel = downloadStateLabel(item.state, t)

  const handleSave = useCallback(async (event: MouseEvent) => {
    event.stopPropagation()
    if (!item.path || !item.filename || !onSaveFile) return
    setSaveState('saving')
    try {
      const outcome = await onSaveFile(item.path, item.filename)
      setSaveState(outcome === 'cancelled' ? 'idle' : outcome)
    } catch {
      setSaveState('error')
    }
  }, [item.filename, item.path, onSaveFile])

  return (
    <div className="rounded border border-border/50 bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {completed && renderFile ? renderFile(item) : (
          <span className="min-w-0 truncate font-medium text-foreground">{item.filename}</span>
        )}
        {stateLabel ? (
          <span className={cn(
            'ml-auto shrink-0 rounded px-1 py-px text-xs',
            completed && 'bg-muted text-muted-foreground',
            inFlight && 'animate-shimmer bg-primary/10 text-foreground',
            failed && 'bg-warning/20 text-warning',
            !completed && !inFlight && !failed && 'bg-muted text-muted-foreground',
          )}>
            {stateLabel}
          </span>
        ) : null}
      </div>
      {item.bytes != null || urlDisplay ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/70">
          {item.bytes != null ? <span className="shrink-0 tabular-nums">{formatBytes(item.bytes)}</span> : null}
          {item.bytes != null && urlDisplay ? <span className="shrink-0">·</span> : null}
          {urlDisplay ? <span className="min-w-0 truncate" title={item.url}>{urlDisplay}</span> : null}
        </div>
      ) : null}
      {completed && item.path && onSaveFile ? (
        <div className="mt-1.5 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            disabled={saveState === 'saving'}
            onClick={handleSave}
          >
            <DownloadIcon className="size-2.5" />
            {saveState === 'saved'
              ? t('chat.toolBlock.browser.downloadSaved')
              : t('chat.toolBlock.browser.downloadSaveTo')}
          </Button>
          {saveState === 'error' ? (
            <span className="text-xs text-warning">{t('chat.toolBlock.browser.downloadSaveFailed')}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function BrowserListDownloadsViewPresenter({
  result,
  renderFile,
  onSaveFile,
}: BrowserListDownloadsViewPresenterProps) {
  const { t } = useTranslation()
  const items = useMemo(() => parseListDownloadsResult(result), [result])

  if (items.length === 0) {
    return (
      <div className="px-0.5 py-1 text-xs italic text-muted-foreground/80">
        {t('chat.toolBlock.browser.listDownloadsEmpty')}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <DownloadListRow
          key={`${item.path ?? item.url ?? item.filename}-${index}`}
          item={item}
          renderFile={renderFile}
          onSaveFile={onSaveFile}
        />
      ))}
    </div>
  )
}
