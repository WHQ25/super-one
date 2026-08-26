import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Ban, TriangleAlert, ImageIcon, Video, Download as DownloadIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { ToolIcon } from './ToolIcon'
import { FileChip } from './ToolBlock'
import { PrettyJSONCodeBlock, BrowserEvaluateView, BrowserMockView } from './tool-result-views'
import { BrowserListDownloadsView } from './BrowserListDownloadsView'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { browserVerbKey, browserInputSummary, parseBrowserResult, isReadBrowserOp, type BrowserOp } from './browser-tool-display'
import { useChatStore } from '@/stores/chat-store'
import { ToolScreenshotView } from './ToolScreenshotView'
import { ToolName } from './tool-row'
import { ActionRecordingView, parseActionRecording } from './ActionRecordingView'
import { BrowserPageToolCallBlock, BrowserPageToolsListBlock } from './BrowserPageToolsBlock'

interface BrowserToolBlockProps {
  op: BrowserOp
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel: StallLevel
  /** When false, header-only (subagent card). Default true. */
  allowExpand?: boolean
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function BrowserToolBlock({ op, params, result, isStreaming, isError, isDenied, elapsedSeconds, stallLevel, allowExpand = true }: BrowserToolBlockProps) {
  if (op === 'tools_list' || op === 'tools_call') {
    const Block = op === 'tools_list' ? BrowserPageToolsListBlock : BrowserPageToolCallBlock
    return (
      <Block
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        elapsedSeconds={elapsedSeconds}
        stallLevel={stallLevel}
        allowExpand={allowExpand}
      />
    )
  }

  if (op === 'download') {
    return (
      <BrowserDownloadBlock
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        elapsedSeconds={elapsedSeconds}
        stallLevel={stallLevel}
      />
    )
  }

  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const verb = t(`chat.toolBlock.browser.${browserVerbKey(op, isStreaming)}`)
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = browserInputSummary(op, params)
  const info = useMemo(() => parseBrowserResult(op, result, !!isError), [op, result, isError])
  const recording = useMemo(() => parseActionRecording(result), [result])

  const denied = !!isDenied || info.status === 'denied'
  const failed = info.status === 'error' || denied
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

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        denied ? 'denied bg-error/10' : failed ? 'errored bg-warning/10' : 'bg-muted/20',
        expandable && 'cursor-pointer',
        expandable && (denied ? 'hover:bg-error/20' : failed ? 'hover:bg-warning/20' : 'hover:bg-muted/40'),
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {denied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : failed ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <ToolIcon icon="globe" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <ToolName
          streaming={isStreaming && !denied}
          tone={denied ? 'denied' : failed ? 'error' : 'default'}
        >
          {isStreaming ? <>{verb}…</> : verb}
        </ToolName>
        {hasScreenshot ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{screenshotLabel}</span>
          </span>
        ) : middle ? (
          <span className="min-w-0 truncate text-muted-foreground">{middle}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {rightCount && <span className="text-muted-foreground/70">{rightCount}</span>}
          {recording && <Video className="size-3 text-muted-foreground/70" aria-label="Action recording" />}
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span className={cn('transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
          )}
          {!isStreaming && denied && (
            <span className="rounded bg-error/20 px-1 py-px text-xs text-error">{t('chat.toolBlock.denied')}</span>
          )}
          {!isStreaming && !denied && info.status === 'error' && (
            <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>
          )}
          {expandable && (
            <ChevronRight className={cn('size-3 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
          )}
        </div>
      </div>

      {expandable && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-1.5">
              {expanded && recording && <ActionRecordingView recording={recording} />}
              {expanded && !recording && (hasScreenshot
                ? (
                    <ToolScreenshotView
                      path={info.imagePath!}
                      label={t('chat.toolBlock.browser.screenshot')}
                      unavailableLabel={t('chat.toolBlock.browser.screenshotUnavailable')}
                    />
                  )
                : op === 'list_downloads'
                  ? <BrowserListDownloadsView result={result!} />
                  : op === 'mock'
                    ? <BrowserMockView params={params} />
                    : op === 'evaluate'
                      ? <BrowserEvaluateView expression={typeof params.expression === 'string' ? params.expression : ''} result={result!} />
                      : <PrettyJSONCodeBlock text={result!} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BrowserDownloadBlock({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
}: Omit<BrowserToolBlockProps, 'op'>) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const info = useMemo(() => parseBrowserResult('download', result, !!isError), [result, isError])
  const parsedTaskId = info.download?.taskId
  const live = useChatStore((s) => {
    if (!parsedTaskId || !s.activeProject) return undefined
    const proj = s.projectSessions[s.activeProject]
    const sid = proj?._activeSessionId
    if (!sid) return undefined
    return proj._sessions[sid]?.browserDownloads[parsedTaskId]
  })

  const url = (typeof params.url === 'string' ? params.url : undefined)
    || info.download?.url
    || live?.url
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
  const expandable = !isStreaming && (!!result || phase === 'background' || completed || failed)

  const verb = inFlight
    ? t('chat.toolBlock.browser.downloading')
    : completed
      ? t('chat.toolBlock.browser.downloaded')
      : failed
        ? t('chat.toolBlock.browser.download')
        : t('chat.toolBlock.browser.download')

  const progressPct = totalBytes && totalBytes > 0 && bytes != null
    ? Math.min(100, Math.round((bytes / totalBytes) * 100))
    : null

  const handleSave = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!path || !filename) return
    setSaveState('saving')
    try {
      const res = await window.app.saveFileAs(path, filename)
      if (res.ok) setSaveState('saved')
      else if (res.canceled) setSaveState('idle')
      else setSaveState('error')
    } catch {
      setSaveState('error')
    }
  }, [path, filename])

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        isDenied ? 'denied bg-error/10' : failed ? 'errored bg-warning/10' : 'bg-muted/20',
        expandable && 'cursor-pointer',
        expandable && (isDenied ? 'hover:bg-error/20' : failed ? 'hover:bg-warning/20' : 'hover:bg-muted/40'),
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : failed ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <ToolIcon icon="download" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <ToolName
          streaming={inFlight && !isDenied}
          tone={isDenied ? 'denied' : failed ? 'error' : 'default'}
        >
          {inFlight ? <>{verb}…</> : verb}
        </ToolName>

        {completed && path && filename ? (
          <FileChip name={filename} title={path} filePath={path} className="max-w-50" />
        ) : inFlight && filename ? (
          <span className="min-w-0 truncate text-muted-foreground">{filename}</span>
        ) : url ? (
          <span className="min-w-0 truncate text-muted-foreground">{url.replace(/^https?:\/\//, '')}</span>
        ) : failed && errorText ? (
          <span className="min-w-0 truncate text-muted-foreground">{errorText}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {inFlight && progressPct != null && (
            <span className="text-muted-foreground/70 tabular-nums">{progressPct}%</span>
          )}
          {inFlight && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span className={cn('transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
          )}
          {!inFlight && isDenied && (
            <span className="rounded bg-error/20 px-1 py-px text-xs text-error">{t('chat.toolBlock.denied')}</span>
          )}
          {!inFlight && !isDenied && failed && (
            <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>
          )}
          {expandable && (
            <ChevronRight className={cn('size-3 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
          )}
        </div>
      </div>

      {expandable && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 px-2 pb-2 pt-0.5 text-xs">
              {phase === 'background' && (
                <div className="text-muted-foreground">
                  <span className="animate-shimmer font-medium text-foreground">{t('chat.toolBlock.browser.downloadBackground')}…</span>
                  <p className="mt-1 text-muted-foreground/80">{t('chat.toolBlock.browser.downloadBackgroundHint')}</p>
                </div>
              )}

              {inFlight && (bytes != null || totalBytes != null) && (
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
                      : bytes != null
                        ? formatBytes(bytes)
                        : null}
                  </div>
                </div>
              )}

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                {filename && (
                  <>
                    <dt className="text-muted-foreground/70">File</dt>
                    <dd className="min-w-0 truncate text-foreground">{filename}</dd>
                  </>
                )}
                {path && (
                  <>
                    <dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadPath')}</dt>
                    <dd className="min-w-0 break-all font-mono text-xs text-foreground/90">{path}</dd>
                  </>
                )}
                {bytes != null && (
                  <>
                    <dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadSize')}</dt>
                    <dd className="tabular-nums text-foreground">{formatBytes(bytes)}</dd>
                  </>
                )}
                {mimeType && (
                  <>
                    <dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadMime')}</dt>
                    <dd className="text-foreground">{mimeType}</dd>
                  </>
                )}
                {url && (
                  <>
                    <dt className="text-muted-foreground/70">{t('chat.toolBlock.browser.downloadUrl')}</dt>
                    <dd className="min-w-0 break-all text-foreground/90">{url}</dd>
                  </>
                )}
                {failed && errorText && (
                  <>
                    <dt className="text-muted-foreground/70">{t('chat.toolBlock.error')}</dt>
                    <dd className="text-warning">{errorText}</dd>
                  </>
                )}
              </dl>

              {completed && path && (
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    disabled={saveState === 'saving'}
                    onClick={handleSave}
                  >
                    <DownloadIcon className="size-3" />
                    {saveState === 'saved'
                      ? t('chat.toolBlock.browser.downloadSaved')
                      : t('chat.toolBlock.browser.downloadSaveTo')}
                  </Button>
                  {saveState === 'error' && (
                    <span className="text-warning">{t('chat.toolBlock.browser.downloadSaveFailed')}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
