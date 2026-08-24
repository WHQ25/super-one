import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Ban,
  ChevronRight,
  ImageIcon,
  MousePointer2,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useAppIcon } from '@/hooks/use-app-icon'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import {
  computerInputSummary,
  computerTargetBundleId,
  computerVerbKey,
  isReadComputerOp,
  parseComputerResult,
  type ComputerOp,
  type ComputerResultInfo,
} from './computer-tool-display'
import { ComputerResultView } from './computer-result-view'
import { ToolScreenshotView } from './ToolScreenshotView'
import { ToolName } from './tool-row'

interface ComputerUseToolBlockProps {
  op: ComputerOp
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

function LeadingIcon({
  isDenied,
  failed,
  needsAttention,
  iconDataUri,
}: {
  isDenied?: boolean
  failed: boolean
  needsAttention: boolean
  iconDataUri?: string
}) {
  if (isDenied) {
    return <Ban className="size-3 shrink-0 text-error" />
  }
  if (failed || needsAttention) {
    return <TriangleAlert className="size-3 shrink-0 text-warning" />
  }
  if (iconDataUri) {
    return (
      <img
        src={iconDataUri}
        alt=""
        draggable={false}
        className="size-3.5 shrink-0 rounded-[22%] object-contain"
      />
    )
  }
  return <MousePointer2 className="size-3 shrink-0 text-muted-foreground" />
}

export function ComputerUseToolBlock({
  op,
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
  allowExpand = true,
}: ComputerUseToolBlockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const info = useMemo(
    () => parseComputerResult(op, result, !!isError, params),
    [op, result, isError, params],
  )
  // list → Computer Use glyph; launch/focus/observe/act → target app icon.
  // Never use frontmost (often SuperOne after background launch).
  const bundleId = useMemo(
    () => computerTargetBundleId(op, params, info),
    [op, params, info],
  )
  const appIcon = useAppIcon(bundleId)
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
  const hasScreenshot = !!info.imagePath && !isStreaming && !failed
  const hasResultJson = !isStreaming && !!result
  const primary = failed
    ? isDenied
      ? description || inputSummary
      : info.errorText || description || inputSummary
    : description ||
      (op === 'snapshot'
        ? parsedSummary.middle || inputSummary
        : inputSummary || parsedSummary.middle)
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
    && !!result
    && (failed || hasScreenshot || isReadComputerOp(op, params) || op === 'act')

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        isDenied
          ? 'denied bg-error/10'
          : failed || needsAttention
            ? 'errored bg-warning/10'
            : 'bg-muted/20',
        expandable && 'cursor-pointer',
        expandable &&
          (isDenied
            ? 'hover:bg-error/20'
            : failed || needsAttention
              ? 'hover:bg-warning/20'
              : 'hover:bg-muted/40'),
      )}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((value) => !value) : undefined}
      >
        <LeadingIcon
          isDenied={isDenied}
          failed={failed}
          needsAttention={needsAttention}
          iconDataUri={appIcon}
        />

        <ToolName
          streaming={isStreaming && !isDenied}
          tone={isDenied ? 'denied' : failed || needsAttention ? 'error' : 'default'}
        >
          {isStreaming ? <>{verb}…</> : verb}
        </ToolName>

        {screenshotAsPrimary ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {t('chat.toolBlock.computer.screenshot')}
            </span>
          </span>
        ) : primary ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {primary}
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {hasScreenshot && !screenshotAsPrimary && (
            <ImageIcon
              className="size-3 text-muted-foreground/70"
              aria-label={t('chat.toolBlock.computer.screenshot')}
            />
          )}
          {rightSummary && (
            <span
              className={cn(
                'text-muted-foreground/70',
                needsAttention && 'text-warning',
              )}
            >
              {rightSummary}
            </span>
          )}
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span
              className={cn(
                'transition-colors duration-500',
                getStallColor(stallLevel),
              )}
            >
              {Math.round(elapsedSeconds)}s
            </span>
          )}
          {!isStreaming && isDenied && (
            <span className="rounded bg-error/20 px-1 py-px text-xs text-error">
              {t('chat.toolBlock.denied')}
            </span>
          )}
          {!isStreaming && !isDenied && info.status === 'error' && (
            <span className="rounded bg-warning/20 px-1 py-px text-xs text-warning">
              {t('chat.toolBlock.error')}
            </span>
          )}
          {expandable && (
            <ChevronRight
              className={cn(
                'size-3 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-90',
              )}
            />
          )}
        </div>
      </div>

      {expandable && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-1.5 px-2 pb-1.5">
              {expanded && hasScreenshot && info.imagePath && (
                <ToolScreenshotView
                  path={info.imagePath}
                  label={t('chat.toolBlock.computer.screenshot')}
                  unavailableLabel={t(
                    'chat.toolBlock.computer.screenshotUnavailable',
                  )}
                />
              )}
              {expanded && hasResultJson && result && (
                <ComputerResultView text={result} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
