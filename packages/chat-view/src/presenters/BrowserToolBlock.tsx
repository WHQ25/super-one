import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Globe, ImageIcon, Video } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { BrowserListDownloadsViewPresenter } from './BrowserListDownloadsView'
import {
  browserInputSummary,
  browserVerbKey,
  isReadBrowserOp,
  parseBrowserResult,
  type BrowserDownloadListItem,
  type BrowserOp,
} from './browser-tool-display'
import {
  BrowserPageToolCallBlockPresenter,
  BrowserPageToolsListBlockPresenter,
  type BrowserPageToolsBlockPresenterProps,
} from './BrowserPageTools'
import { ToolName, ToolRow, ToolSummary, type ToolRowTone } from './ToolRow'

export interface BrowserDownloadRuntime {
  status?: 'progressing' | 'completed' | 'failed'
  path?: string
  filename?: string
  bytes?: number
  totalBytes?: number
  mimeType?: string
  url?: string
  error?: string
}

export type BrowserDetail =
  | { kind: 'mock'; params: Record<string, unknown> }
  | { kind: 'evaluate'; expression: string; result: string }
  | { kind: 'json'; result: string }

export interface BrowserToolBlockPresenterProps {
  op: BrowserOp
  params: Record<string, unknown>
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  elapsedClassName?: string
  allowExpand?: boolean
  renderIcon?: (kind: 'globe' | 'download') => ReactNode
  renderScreenshot?: (path: string, label: string, unavailableLabel: string) => ReactNode
  renderDetail?: (detail: BrowserDetail) => ReactNode
  renderFile?: (path: string, filename: string) => ReactNode
  onSaveFile?: (path: string, filename: string) => Promise<'saved' | 'cancelled' | 'error'>
  recording?: ReactNode
  downloadRuntime?: BrowserDownloadRuntime
  pageTools?: Pick<BrowserPageToolsBlockPresenterProps, 'renderPageIcon' | 'renderJson'>
}

function defaultIcon(kind: 'globe' | 'download') {
  return kind === 'download'
    ? <Download className="size-3 shrink-0 text-muted-foreground" />
    : <Globe className="size-3 shrink-0 text-muted-foreground" />
}

function defaultDetail(detail: BrowserDetail) {
  const text = detail.kind === 'mock'
    ? JSON.stringify(detail.params, null, 2)
    : detail.kind === 'evaluate'
      ? [detail.expression, detail.result].filter(Boolean).join('\n\n')
      : detail.result
  let display = text
  try { display = JSON.stringify(JSON.parse(text), null, 2) } catch { /* preserve text */ }
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-foreground/85">{display}</pre>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function elapsed(seconds: number | undefined, className?: string) {
  if (seconds == null || seconds < 1) return null
  return <span className={cn('transition-colors duration-500', className ?? 'text-muted-foreground')}>{Math.round(seconds)}s</span>
}

export function BrowserToolBlockPresenter(props: BrowserToolBlockPresenterProps) {
  const {
    op,
    params,
    result,
    toolSummary,
    isStreaming,
    isError,
    isDenied,
    elapsedSeconds,
    elapsedClassName,
    allowExpand = true,
    renderIcon = defaultIcon,
    renderScreenshot,
    renderDetail = defaultDetail,
    renderFile,
    onSaveFile,
    recording,
    downloadRuntime,
    pageTools,
  } = props

  if (op === 'tools_list' || op === 'tools_call') {
    const PageBlock = op === 'tools_list'
      ? BrowserPageToolsListBlockPresenter
      : BrowserPageToolCallBlockPresenter
    return (
      <PageBlock
        params={params}
        result={result}
        toolSummary={toolSummary}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        elapsedSeconds={elapsedSeconds}
        elapsedClassName={elapsedClassName}
        allowExpand={allowExpand}
        {...pageTools}
      />
    )
  }

  if (op === 'download') {
    return <BrowserDownloadBlock {...props} />
  }

  return (
    <BrowserOperationBlock
      op={op}
      params={params}
      result={result}
      toolSummary={toolSummary}
      isStreaming={isStreaming}
      isError={isError}
      isDenied={isDenied}
      elapsedSeconds={elapsedSeconds}
      elapsedClassName={elapsedClassName}
      allowExpand={allowExpand}
      renderIcon={renderIcon}
      renderScreenshot={renderScreenshot}
      renderDetail={renderDetail}
      renderFile={renderFile}
      onSaveFile={onSaveFile}
      recording={recording}
      downloadRuntime={downloadRuntime}
    />
  )
}

function BrowserOperationBlock({
  op,
  params,
  result,
  toolSummary,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  elapsedClassName,
  allowExpand = true,
  renderIcon = defaultIcon,
  renderScreenshot,
  renderDetail = defaultDetail,
  renderFile,
  onSaveFile,
  recording,
}: BrowserToolBlockPresenterProps) {
  const { t } = useTranslation()
  const verb = t(`chat.toolBlock.browser.${browserVerbKey(op, isStreaming)}`)
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = browserInputSummary(op, params) || toolSummary?.trim() || ''
  const info = useMemo(() => parseBrowserResult(op, result, !!isError), [op, result, isError])
  const denied = !!isDenied || info.status === 'denied'
  const failed = info.status === 'error' || denied
  const tone: ToolRowTone = denied ? 'denied' : failed ? 'error' : 'default'
  const hasScreenshot = op === 'screenshot' && !!info.imagePath && !isStreaming && !failed
  const countLabel = info.count
    ? t(`chat.toolBlock.browser.${info.count.kind === 'tabs' ? 'tabsCount' : info.count.kind === 'cookies' ? 'cookiesCount' : info.count.kind}`, { count: info.count.n })
    : info.notFound
      ? t('chat.toolBlock.browser.notFound')
      : ''
  const primary = failed
    ? (denied ? (description || inputSummary) : (info.errorText || description || inputSummary))
    : (description || inputSummary)
  const middle = primary || countLabel
  const rightCount = !failed && primary && countLabel ? countLabel : ''
  const screenshotLabel = hasScreenshot ? (primary || t('chat.toolBlock.browser.viewport')) : ''
  const isMockDetail = op === 'mock' && params.clear !== true && !failed
  const expandable = allowExpand
    && !isStreaming
    && (isMockDetail || (!!result && (isReadBrowserOp(op) || info.status === 'error' || denied || hasScreenshot || !!recording)))
  let details: ReactNode = null
  if (recording) {
    details = recording
  } else if (hasScreenshot && renderScreenshot) {
    details = renderScreenshot(
      info.imagePath!,
      t('chat.toolBlock.browser.screenshot'),
      t('chat.toolBlock.browser.screenshotUnavailable'),
    )
  } else if (op === 'list_downloads' && result) {
    details = (
      <BrowserListDownloadsViewPresenter
        result={result}
        renderFile={renderFile ? (item: BrowserDownloadListItem) => (
          item.path ? renderFile(item.path, item.filename) : item.filename
        ) : undefined}
        onSaveFile={onSaveFile}
      />
    )
  } else if (op === 'mock') {
    details = renderDetail({ kind: 'mock', params })
  } else if (op === 'evaluate' && result) {
    details = renderDetail({
      kind: 'evaluate',
      expression: typeof params.expression === 'string' ? params.expression : '',
      result,
    })
  } else if (result) {
    details = renderDetail({ kind: 'json', result })
  }

  return (
    <ToolRow
      icon={renderIcon('globe')}
      tone={tone}
      expandable={expandable}
      details={details}
      detailsClassName="px-2 pb-1.5"
      mountDetails="expanded"
      trailing={(
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {rightCount ? <span className="text-muted-foreground/70">{rightCount}</span> : null}
          {recording ? <Video className="size-3 text-muted-foreground/70" aria-label="Action recording" /> : null}
          {isStreaming ? elapsed(elapsedSeconds, elapsedClassName) : null}
        </div>
      )}
    >
      <ToolName streaming={isStreaming && !denied} tone={tone}>{isStreaming ? `${verb}…` : verb}</ToolName>
      {hasScreenshot ? (
        <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
          <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{screenshotLabel}</span>
        </span>
      ) : middle ? <ToolSummary>{middle}</ToolSummary> : null}
    </ToolRow>
  )
}

function BrowserDownloadBlock({
  params,
  result,
  toolSummary,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  elapsedClassName,
  allowExpand = true,
  renderIcon = defaultIcon,
  renderFile,
  onSaveFile,
  downloadRuntime: live,
}: BrowserToolBlockPresenterProps) {
  const { t } = useTranslation()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const info = useMemo(() => parseBrowserResult('download', result, !!isError), [result, isError])
  const url = (typeof params.url === 'string' ? params.url : undefined) || info.download?.url || live?.url
  const filename = info.download?.filename
    || live?.filename
    || (url ? url.split('/').pop()?.split('?')[0] : undefined)
    || (typeof params.filename === 'string' ? params.filename : undefined)
  const path = info.download?.path || live?.path
  const bytes = info.download?.bytes ?? live?.bytes
  const totalBytes = live?.totalBytes
  const mimeType = info.download?.mimeType || live?.mimeType
  const errorText = info.errorText || info.download?.error || live?.error
  const phase = isDenied
    ? 'failed' as const
    : isStreaming
      ? 'streaming' as const
      : live?.status === 'completed' || info.download?.phase === 'completed'
        ? 'completed' as const
        : live?.status === 'failed' || info.download?.phase === 'failed' || info.status === 'error'
          ? 'failed' as const
          : info.download?.phase === 'background' || live?.status === 'progressing'
            ? 'background' as const
            : info.download?.phase ?? 'streaming'
  const inFlight = phase === 'streaming' || phase === 'background'
  const failed = phase === 'failed' || !!isDenied
  const completed = phase === 'completed' && !!path
  const tone: ToolRowTone = isDenied ? 'denied' : failed ? 'error' : 'default'
  const expandable = allowExpand && !isStreaming && (!!result || phase === 'background' || completed || failed)
  const verb = inFlight
    ? t('chat.toolBlock.browser.downloading')
    : completed
      ? t('chat.toolBlock.browser.downloaded')
      : t('chat.toolBlock.browser.download')
  const progressPct = totalBytes && totalBytes > 0 && bytes != null
    ? Math.min(100, Math.round((bytes / totalBytes) * 100))
    : null
  const handleSave = useCallback(async (event: MouseEvent) => {
    event.stopPropagation()
    if (!path || !filename || !onSaveFile) return
    setSaveState('saving')
    try {
      const outcome = await onSaveFile(path, filename)
      setSaveState(outcome === 'cancelled' ? 'idle' : outcome)
    } catch {
      setSaveState('error')
    }
  }, [filename, onSaveFile, path])
  const details = (
    <div className="space-y-2 px-2 pb-2 pt-0.5 text-xs">
      {phase === 'background' ? (
        <div className="text-muted-foreground">
          <span className="animate-shimmer font-medium text-foreground">{t('chat.toolBlock.browser.downloadBackground')}…</span>
          <p className="mt-1 text-muted-foreground/80">{t('chat.toolBlock.browser.downloadBackgroundHint')}</p>
        </div>
      ) : null}
      {inFlight && (bytes != null || totalBytes != null) ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full bg-primary/70 transition-all duration-300', progressPct == null && 'w-1/3 animate-pulse')}
              style={progressPct != null ? { width: `${progressPct}%` } : undefined}
            />
          </div>
          <div className="text-muted-foreground/80 tabular-nums">
            {totalBytes != null && bytes != null
              ? t('chat.toolBlock.browser.downloadProgress', { loaded: formatBytes(bytes), total: formatBytes(totalBytes) })
              : bytes != null ? formatBytes(bytes) : null}
          </div>
        </div>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        {filename ? <><dt className="text-muted-foreground/70">File</dt><dd className="min-w-0 truncate text-foreground">{filename}</dd></> : null}
        {path ? <><dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadPath')}</dt><dd className="min-w-0 break-all font-mono text-xs text-foreground/90">{path}</dd></> : null}
        {bytes != null ? <><dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadSize')}</dt><dd className="tabular-nums text-foreground">{formatBytes(bytes)}</dd></> : null}
        {mimeType ? <><dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadMime')}</dt><dd className="text-foreground">{mimeType}</dd></> : null}
        {url ? <><dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadUrl')}</dt><dd className="min-w-0 break-all text-foreground/90">{url}</dd></> : null}
        {failed && errorText ? <><dt className="text-muted-foreground/70">{t('chat.toolBlock.error')}</dt><dd className="text-warning">{errorText}</dd></> : null}
      </dl>
      {completed && path && onSaveFile ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={saveState === 'saving'} onClick={handleSave}>
            <Download className="size-3" />
            {saveState === 'saved' ? t('chat.toolBlock.browser.downloadSaved') : t('chat.toolBlock.browser.downloadSaveTo')}
          </Button>
          {saveState === 'error' ? <span className="text-warning">{t('chat.toolBlock.browser.downloadSaveFailed')}</span> : null}
        </div>
      ) : null}
    </div>
  )
  const summary = completed && path && filename && renderFile
    ? renderFile(path, filename)
    : inFlight && filename
      ? <ToolSummary>{filename}</ToolSummary>
      : url
        ? <ToolSummary>{url.replace(/^https?:\/\//, '')}</ToolSummary>
        : failed && errorText
          ? <ToolSummary>{errorText}</ToolSummary>
          : toolSummary ? <ToolSummary>{toolSummary}</ToolSummary> : null

  return (
    <ToolRow
      icon={renderIcon('download')}
      tone={tone}
      expandable={expandable}
      details={details}
      detailsClassName="p-0"
      trailing={(
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {inFlight && progressPct != null ? <span className="text-muted-foreground/70 tabular-nums">{progressPct}%</span> : null}
          {inFlight ? elapsed(elapsedSeconds, elapsedClassName) : null}
        </div>
      )}
    >
      <ToolName streaming={inFlight && !isDenied} tone={tone}>{inFlight ? `${verb}…` : verb}</ToolName>
      {summary}
    </ToolRow>
  )
}
