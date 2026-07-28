import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download as DownloadIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { FileChip } from './ToolBlock'
import { parseListDownloadsResult, type BrowserDownloadListItem } from './browser-tool-display'

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

function DownloadListRow({ item }: { item: BrowserDownloadListItem }) {
  const { t } = useTranslation()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const completed = item.state === 'completed' && !!item.path
  const failed = item.state === 'cancelled' || item.state === 'interrupted'
  const inFlight = item.state === 'progressing'
  const urlDisplay = item.url ? item.url.replace(/^https?:\/\//, '') : ''
  const stateLabel = downloadStateLabel(item.state, t)

  const handleSave = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.path || !item.filename) return
    setSaveState('saving')
    try {
      const res = await window.app.saveFileAs(item.path, item.filename)
      if (res.ok) setSaveState('saved')
      else if (res.canceled) setSaveState('idle')
      else setSaveState('error')
    } catch {
      setSaveState('error')
    }
  }, [item.path, item.filename])

  return (
    <div className="rounded border border-border/50 bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {completed && item.path ? (
          <FileChip name={item.filename} title={item.path} filePath={item.path} className="max-w-45" />
        ) : (
          <span className="min-w-0 truncate font-medium text-foreground">{item.filename}</span>
        )}
        {stateLabel && (
          <span
            className={cn(
              'ml-auto shrink-0 rounded px-1 py-px text-xs',
              completed && 'bg-muted text-muted-foreground',
              inFlight && 'animate-shimmer bg-primary/10 text-foreground',
              failed && 'bg-warning/20 text-warning',
              !completed && !inFlight && !failed && 'bg-muted text-muted-foreground',
            )}
          >
            {stateLabel}
          </span>
        )}
      </div>
      {(item.bytes != null || urlDisplay) && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/70">
          {item.bytes != null && (
            <span className="shrink-0 tabular-nums">{formatBytes(item.bytes)}</span>
          )}
          {item.bytes != null && urlDisplay && <span className="shrink-0">·</span>}
          {urlDisplay && (
            <span className="min-w-0 truncate" title={item.url}>{urlDisplay}</span>
          )}
        </div>
      )}
      {completed && item.path && (
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
          {saveState === 'error' && (
            <span className="text-xs text-warning">{t('chat.toolBlock.browser.downloadSaveFailed')}</span>
          )}
        </div>
      )}
    </div>
  )
}

export function BrowserListDownloadsView({ result }: { result: string }) {
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
      {items.map((item, i) => (
        <DownloadListRow key={`${item.path ?? item.url ?? item.filename}-${i}`} item={item} />
      ))}
    </div>
  )
}
