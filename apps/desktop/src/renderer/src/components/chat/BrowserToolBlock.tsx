import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Ban, TriangleAlert, ImageIcon } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { ToolIcon } from './ToolIcon'
import { PrettyJSONCodeBlock, BrowserEvaluateView } from './tool-result-views'
import { ImageInteractive, useImageDataUri } from './codex-image-shared'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { browserVerbKey, browserInputSummary, parseBrowserResult, isReadBrowserOp, type BrowserOp } from './browser-tool-display'

interface BrowserToolBlockProps {
  op: BrowserOp
  params: Record<string, unknown>
  result?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel: StallLevel
}

export function BrowserToolBlock({ op, params, result, isStreaming, isError, isDenied, elapsedSeconds, stallLevel }: BrowserToolBlockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const verb = t(`chat.toolBlock.browser.${browserVerbKey(op)}`)
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = browserInputSummary(op, params)
  const info = useMemo(() => parseBrowserResult(op, result, !!isError), [op, result, isError])

  const failed = info.status === 'error' || !!isDenied
  const hasScreenshot = op === 'screenshot' && !!info.imagePath && !isStreaming && !failed

  const countLabel = info.count
    ? t(`chat.toolBlock.browser.${info.count.kind === 'tabs' ? 'tabsCount' : info.count.kind}`, { count: info.count.n })
    : info.notFound
      ? t('chat.toolBlock.browser.notFound')
      : ''

  const primary = failed
    ? (isDenied ? (description || inputSummary) : (info.errorText || description || inputSummary))
    : (description || inputSummary)
  const middle = primary || countLabel
  const rightCount = !failed && primary && countLabel ? countLabel : ''

  const screenshotLabel = hasScreenshot ? (primary || t('chat.toolBlock.browser.viewport')) : ''
  const expandable = !isStreaming && !!result && (isReadBrowserOp(op) || info.status === 'error' || hasScreenshot)

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
          <ToolIcon icon="globe" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('shrink-0 font-medium', isDenied ? 'text-error' : failed ? 'text-warning' : 'text-foreground')}>
          {isStreaming ? <>{verb}…</> : verb}
        </span>
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
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span className={cn('transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
          )}
          {!isStreaming && isDenied && (
            <span className="rounded bg-error/20 px-1 py-px text-[10px] text-error">{t('chat.toolBlock.denied')}</span>
          )}
          {!isStreaming && !isDenied && info.status === 'error' && (
            <span className="rounded bg-warning/20 px-1 py-px text-[10px] text-warning">{t('chat.toolBlock.error')}</span>
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
              {expanded && (hasScreenshot
                ? <BrowserScreenshotView path={info.imagePath!} />
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

function BrowserScreenshotView({ path }: { path: string }) {
  const { t } = useTranslation()
  const { dataUri, loadError } = useImageDataUri(path, false)
  const [open, setOpen] = useState(false)

  if (loadError) {
    return <div className="text-[11px] text-muted-foreground/60 italic">{t('chat.toolBlock.browser.screenshotUnavailable')}</div>
  }
  if (!dataUri) return null

  return (
    <>
      <ImageInteractive
        savedPath={path}
        onOpen={() => setOpen(true)}
        ariaLabel={t('chat.toolBlock.browser.screenshot')}
        className="block max-w-full cursor-zoom-in overflow-hidden rounded border border-border/60 bg-muted/30 transition-shadow hover:shadow-sm"
      >
        <img src={dataUri} alt={t('chat.toolBlock.browser.screenshot')} className="block max-h-80 w-auto max-w-full object-contain" />
      </ImageInteractive>

      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          showCloseButton
          className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{t('chat.toolBlock.browser.screenshot')}</DialogTitle>
          <div className="absolute inset-0 px-[5vw] py-[5vh]">
            <ImagePreview src={dataUri} alt={t('chat.toolBlock.browser.screenshot')} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
