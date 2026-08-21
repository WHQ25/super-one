import { useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Code2, ImageIcon, Smartphone } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import {
  deviceInputSummary,
  deviceNeedsAttention,
  deviceVerbKey,
  parseDeviceResult,
  type DeviceOp,
  type DeviceResultInfo,
} from './device-tool-display'
import { PrettyJSONCodeBlock } from './tool-result-views'
import { ToolScreenshotView } from './ToolScreenshotView'
import {
  CompactLabeledToolRow,
  ToolName,
  ToolRow,
  ToolSummary,
  type ToolRowTone,
} from './tool-row'

interface DeviceToolBlockProps {
  op: DeviceOp
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

/**
 * The device glyph turns with the guest.
 *
 * The orientation is already in every snapshot and act result, and a phone lying on
 * its side is the one piece of device state a user cannot infer from the summary —
 * so it dyes the icon that is there rather than adding a badge next to it.
 */
function DeviceIcon({ info }: { info: DeviceResultInfo }) {
  const landscape = info.orientation === 'landscape-left' || info.orientation === 'landscape-right'
  return (
    <Smartphone
      className={cn(
        'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
        landscape && 'rotate-90',
      )}
    />
  )
}

function CollapsedJsonRow({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        onToggle()
      }}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <Code2 className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <ChevronRight
        className={cn('size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')}
      />
    </button>
  )
}

export function DeviceToolBlock({
  op,
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
  allowExpand = true,
}: DeviceToolBlockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [jsonExpanded, setJsonExpanded] = useState(false)
  const info = useMemo(
    () => parseDeviceResult(op, result, !!isError),
    [op, result, isError],
  )

  const failed = info.status === 'error' || !!isDenied
  const needsAttention = !failed && deviceNeedsAttention(info)
  const tone: ToolRowTone = isDenied ? 'denied' : info.status === 'error' ? 'error'
    : needsAttention ? 'warning' : 'default'
  const label = t(`chat.toolBlock.device.${deviceVerbKey(op, params, isStreaming)}`)

  if (!allowExpand) {
    return (
      <CompactLabeledToolRow
        icon={<DeviceIcon info={info} />}
        label={isStreaming ? `${label}…` : label}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  // The schema makes `description` required and asks for it in the conversation's
  // language, so it is the summary. Refs and coordinates are the fallback for an
  // agent that skipped it, not the primary reading.
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  const primary = failed
    ? (isDenied ? description : info.errorText || description)
    : description || deviceInputSummary(op, params)

  const status = !isStreaming && !failed ? statusText(op, info, t) : null
  const hasScreenshot = !!info.imagePath && !isStreaming && !failed
  const hasResultJson = !isStreaming && !!result
  // `reason` explains a didnt; without it the user sees a warning row and no cause.
  const explanation = info.failure || (info.outcome === 'didnt' ? info.reason : undefined)
  const expandable = !isStreaming && !!result

  return (
    <ToolRow
      icon={<DeviceIcon info={info} />}
      tone={tone}
      expandable={expandable}
      expanded={expanded}
      onExpandedChange={setExpanded}
      detailsClassName="border-t border-border/40 px-2 py-2 text-xs"
      details={expandable ? (
        <div className="flex flex-col gap-1.5">
          {explanation && (
            <span className={cn('text-xs', needsAttention ? 'text-warning' : 'text-muted-foreground')}>
              {explanation}
            </span>
          )}
          {expanded && hasScreenshot && info.imagePath && (
            <ToolScreenshotView
              path={info.imagePath}
              label={t('chat.toolBlock.device.screenshot')}
              unavailableLabel={t('chat.toolBlock.device.screenshotUnavailable')}
            />
          )}
          {expanded && hasScreenshot && hasResultJson && result && (
            <div className="rounded bg-muted/30">
              <CollapsedJsonRow
                expanded={jsonExpanded}
                onToggle={() => setJsonExpanded((value) => !value)}
                label={t('chat.toolBlock.device.json')}
              />
              {jsonExpanded && (
                <div className="px-1 pb-1">
                  <PrettyJSONCodeBlock text={result} />
                </div>
              )}
            </div>
          )}
          {expanded && !hasScreenshot && result && <PrettyJSONCodeBlock text={result} />}
        </div>
      ) : undefined}
      trailing={(
        <div className="flex shrink-0 items-center gap-1.5">
          {hasScreenshot && (
            <ImageIcon
              className="size-3 text-muted-foreground/70"
              aria-label={t('chat.toolBlock.device.screenshot')}
            />
          )}
          {info.settled === false && !failed && !isStreaming && (
            <span
              className="text-muted-foreground/70"
              title={t('chat.toolBlock.device.movingHint')}
            >
              {t('chat.toolBlock.device.moving')}
            </span>
          )}
          {status && (
            <span className={cn('text-muted-foreground/70', needsAttention && 'text-warning')}>
              {status}
            </span>
          )}
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
            <span className={cn('transition-colors duration-500', getStallColor(stallLevel))}>
              {Math.round(elapsedSeconds)}s
            </span>
          )}
        </div>
      )}
    >
      <ToolName streaming={isStreaming && !isDenied} tone={tone}>
        {isStreaming ? `${label}…` : label}
      </ToolName>
      {primary ? <ToolSummary>{primary}</ToolSummary> : null}
      {/* Eats the slack so status and chevron sit together on the right. Two
          `ml-auto` siblings would split it between them instead, stranding the
          status mid-row. */}
      <span className="flex-1" />
    </ToolRow>
  )
}

/**
 * The one word that says how the call landed.
 *
 * `worked` is deliberately silent: the done label is already past tense and the row
 * already reads as normal, so restating it is noise. The states that cost the user
 * something to miss — didn't, unclear, timed out, and a wait that never had to wait —
 * are the ones worth a word.
 */
function statusText(
  op: DeviceOp,
  info: DeviceResultInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (op === 'act') {
    return info.outcome && info.outcome !== 'worked'
      ? t(`chat.toolBlock.device.outcome.${info.outcome}`)
      : ''
  }
  if (op === 'wait_for') {
    return info.waitStatus ? t(`chat.toolBlock.device.waitStatus.${info.waitStatus}`) : ''
  }
  if (op === 'query') {
    return info.matches != null
      ? t('chat.toolBlock.device.matchesCount', { count: info.matches })
      : ''
  }
  return info.truncated ? t('chat.toolBlock.device.truncated') : ''
}
