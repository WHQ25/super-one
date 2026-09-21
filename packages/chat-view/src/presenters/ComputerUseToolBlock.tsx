import { InteractionMemoryToolBlock } from './InteractionMemoryToolBlock'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ImageIcon,
  MousePointer2,
  Video,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  computerInputSummary,
  computerVerbKey,
  isReadComputerOp,
  parseComputerResult,
  type ComputerOp,
  type ComputerResultInfo,
} from './computer-tool-display'
import { ToolScreenshotViewPresenter } from './ToolScreenshotView'
import { ToolName, ToolRow, ToolSummary, type ToolRowTone } from './ToolRow'
import { RunBlockPresenter, type RunVocabulary } from './RunBlock'
import { runCallOf, type RunCall, type RunContinuation } from './run-display'
import type { JevRunAction } from '@superone/shared/agent-types'

export interface ComputerUseToolBlockPresenterProps {
  op: ComputerOp
  params: Record<string, unknown>
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  elapsedClassName?: string
  /** When false, header-only (subagent card). Default true. */
  allowExpand?: boolean
  identityIcon?: ReactNode
  renderScreenshot?: (path: string, label: string, unavailableLabel: string) => ReactNode
  renderResult?: (text: string) => ReactNode
  recording?: ReactNode
  /** computer_run only: the rows the store holds for the call still in flight. */
  runActions?: JevRunAction[]
  /** computer_run only: the resume calls folded into this block. */
  runContinuations?: RunContinuation[]
  /** `*_run` only: open the run's segments on first render. */
  runExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  pendingDetails?: ReactNode
}

/** A run on the desktop speaks the computer tools' own verbs. */
const RUN_VOCAB: RunVocabulary = {
  run: 'chat.toolBlock.computer.run',
  running: 'chat.toolBlock.computer.running',
  paused: 'chat.toolBlock.computer.runPaused',
  done: 'chat.toolBlock.computer.runDone',
  aborted: 'chat.toolBlock.computer.runAborted',
  click: 'chat.toolBlock.computer.click',
  type: 'chat.toolBlock.computer.type',
  press: 'chat.toolBlock.computer.press',
  scroll: 'chat.toolBlock.computer.scroll',
  wait: 'chat.toolBlock.computer.waitFor',
  scrollUp: 'chat.toolBlock.computer.scrollUp',
  scrollDown: 'chat.toolBlock.computer.scrollDown',
  count: 'chat.toolBlock.computer.runActions',
}

function defaultResult(text: string) {
  let display = text
  try { display = JSON.stringify(JSON.parse(text), null, 2) } catch { /* preserve text */ }
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-foreground/85">{display}</pre>
}

function resultSummary(
  op: ComputerOp,
  info: ComputerResultInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): { middle: string; right: string } {
  if (op === 'apps') {
    const page = info.counts?.apps
    const total = info.counts?.total
    const running = info.counts?.running
    const roots = info.counts?.roots
    return {
      middle:
        info.app ||
        (total != null
          ? t('chat.toolBlock.computer.appsCount', { count: total })
          : running != null
            ? t('chat.toolBlock.computer.appsCount', { count: running })
            : page != null
              ? t('chat.toolBlock.computer.appsCount', { count: page })
              : ''),
      right:
        roots != null
          ? t('chat.toolBlock.computer.windowsCount', { count: roots })
          : page != null && total != null && total !== page
            ? `${page}/${total}`
            : '',
    }
  }
  if (op === 'query' && info.counts?.matches != null) {
    return {
      middle: t('chat.toolBlock.computer.matchesCount', {
        count: info.counts.matches,
      }),
      right: '',
    }
  }
  if (op === 'act' && info.outcome) {
    return {
      middle: '',
      right: t(`chat.toolBlock.computer.outcome.${info.outcome}`),
    }
  }
  if (op === 'wait_for' && info.waitStatus) {
    return {
      middle: '',
      right: t(`chat.toolBlock.computer.waitStatus.${info.waitStatus}`),
    }
  }
  // Avoid "SuperOne CU Lab · SuperOne CU Lab" when window title equals app name.
  const app = info.app?.trim() ?? ''
  const title = info.title?.trim() ?? ''
  const middle =
    app && title && app !== title
      ? `${app} \u00b7 ${title}`
      : app || title
  return { middle, right: '' }
}

export function ComputerUseToolBlockPresenter(props: ComputerUseToolBlockPresenterProps) {
  if (props.op === 'memory_read' || props.op === 'memory_write') {
    return <InteractionMemoryToolBlock {...props} family="computer" op={props.op} />
  }
  if (props.op === 'run') return <ComputerRunBlock {...props} />
  return <ComputerUseToolBlockOperation {...props} />
}

/** The app a run works in: named by the caller, or by the last snapshot's root. */
function runTarget(params: Record<string, unknown>): (view: { snapshot?: Record<string, unknown> }) => string | undefined {
  return (view) => {
    const target = view.snapshot?.target as Record<string, unknown> | undefined
    const app = typeof target?.app === 'string' ? target.app : typeof params.app === 'string' ? params.app : ''
    return app.trim() || undefined
  }
}

function ComputerRunBlock({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  elapsedClassName,
  allowExpand,
  identityIcon,
  runActions,
  runContinuations,
  runExpanded,
  onExpandedChange,
}: ComputerUseToolBlockPresenterProps) {
  const calls: RunCall[] = [
    { params, result, isStreaming, isError, elapsedSeconds },
    ...(runContinuations ?? []).map(runCallOf),
  ]
  return (
    <RunBlockPresenter
      calls={calls}
      liveActions={runActions}
      vocab={RUN_VOCAB}
      icon={identityIcon ?? <MousePointer2 className="size-3 shrink-0 text-muted-foreground" />}
      target={runTarget(params)}
      description={typeof params.description === 'string' ? params.description : undefined}
      isDenied={isDenied}
      elapsedClassName={elapsedClassName}
      allowExpand={allowExpand}
      defaultExpanded={runExpanded}
      onExpandedChange={onExpandedChange}
    />
  )
}

function ComputerUseToolBlockOperation({
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
  identityIcon,
  renderScreenshot,
  renderResult = defaultResult,
  recording,
  onExpandedChange,
  pendingDetails,
}: ComputerUseToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(
    () => parseComputerResult(op, result, !!isError, params),
    [op, result, isError, params],
  )
  const verb = t(
    `chat.toolBlock.computer.${computerVerbKey(op, params, isStreaming)}`,
  )
  const description =
    typeof params.description === 'string' ? params.description.trim() : ''
  const inputSummary = computerInputSummary(op, params)
  const parsedSummary = resultSummary(op, info, t)
  const failed = info.status === 'error' || !!isDenied
  const needsAttention =
    info.outcome === 'didnt' || info.waitStatus === 'failed'
  const tone: ToolRowTone = isDenied ? 'denied' : failed ? 'error'
    : needsAttention ? 'warning' : 'default'
  const hasScreenshot = !!info.imagePath && !isStreaming && !failed
  const hasResultJson = !isStreaming && !!result
  const primary = failed
    ? isDenied
      ? description || inputSummary || toolSummary?.trim() || ''
      : info.errorText || description || inputSummary || toolSummary?.trim() || ''
    : description ||
      (op === 'snapshot'
        ? parsedSummary.middle || inputSummary
        : inputSummary || parsedSummary.middle) || toolSummary?.trim() || ''
  const rightSummary =
    failed || isStreaming
      ? ''
      : parsedSummary.right ||
        (description && op === 'query' ? parsedSummary.middle : '')
  const screenshotAsPrimary = hasScreenshot && !primary
  // Header expand reveals the body. With a screenshot, body shows image + a
  // nested collapsed JSON row; without one, body is the full PrettyJSON.
  const expandable =
    allowExpand
    && !isStreaming
    && (pendingDetails != null || (!!result && (failed || hasScreenshot || isReadComputerOp(op, params) || op === 'act')))

  return (
    <ToolRow
      icon={identityIcon ?? <MousePointer2 className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={expandable}
      mountDetails="expanded"
      detailsClassName="px-2 pb-1.5"
      onExpandedChange={onExpandedChange}
      details={expandable ? (
        <div className="flex flex-col gap-1.5">
          {hasScreenshot && info.imagePath && (
            renderScreenshot?.(
              info.imagePath,
              t('chat.toolBlock.computer.screenshot'),
              t('chat.toolBlock.computer.screenshotUnavailable'),
            ) ?? (
              <ToolScreenshotViewPresenter
                path={info.imagePath}
                label={t('chat.toolBlock.computer.screenshot')}
                unavailableLabel={t('chat.toolBlock.computer.screenshotUnavailable')}
              />
            )
          )}
          {recording}
          {hasResultJson && result && renderResult(result)}
          {!result && pendingDetails}
        </div>
      ) : undefined}
      trailing={(
        <div className="flex shrink-0 items-center gap-1.5">
          {hasScreenshot && !screenshotAsPrimary && (
            <ImageIcon
              className="size-3 text-muted-foreground/70"
              aria-label={t('chat.toolBlock.computer.screenshot')}
            />
          )}
          {recording && (
            <Video className="size-3 text-muted-foreground/70" aria-label="Action recording" />
          )}
          {rightSummary && (
            <span className={cn('text-muted-foreground/70', needsAttention && 'text-warning')}>
              {rightSummary}
            </span>
          )}
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span className={cn('transition-colors duration-500', elapsedClassName ?? 'text-muted-foreground')}>
              {Math.round(elapsedSeconds)}s
            </span>
          )}
        </div>
      )}
    >
      <ToolName streaming={isStreaming && !isDenied} tone={tone}>
          {isStreaming ? <>{verb}…</> : verb}
      </ToolName>

      {screenshotAsPrimary ? (
        <ToolSummary>
          <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{t('chat.toolBlock.computer.screenshot')}</span>
          </span>
        </ToolSummary>
      ) : primary ? <ToolSummary>{primary}</ToolSummary> : null}
    </ToolRow>
  )
}
