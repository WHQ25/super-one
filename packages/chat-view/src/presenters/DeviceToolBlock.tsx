import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Code2, ImageIcon, Smartphone, Video } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  deviceInputSummary,
  deviceNeedsAttention,
  deviceVerbKey,
  parseDeviceResult,
  type DeviceListGroup,
  type DeviceOp,
  type DeviceResultInfo,
} from './device-tool-display'
import { ToolScreenshotViewPresenter } from './ToolScreenshotView'
import {
  CompactLabeledToolRow,
  ToolName,
  ToolRow,
  ToolSummary,
  type ToolRowTone,
} from './ToolRow'

export interface DeviceToolBlockPresenterProps {
  op: DeviceOp
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
  renderScreenshot?: (path: string, label: string, unavailableLabel: string) => ReactNode
  renderJson?: (text: string) => ReactNode
  recording?: ReactNode
}

function defaultJson(text: string) {
  let display = text
  try { display = JSON.stringify(JSON.parse(text), null, 2) } catch { /* preserve text */ }
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-foreground/85">{display}</pre>
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

export function DeviceToolBlockPresenter({
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
  renderScreenshot,
  renderJson = defaultJson,
  recording,
}: DeviceToolBlockPresenterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [jsonExpanded, setJsonExpanded] = useState(false)
  const info = useMemo(
    () => parseDeviceResult(op, result, !!isError),
    [op, result, isError],
  )
  const declined = isDenied || info.status === 'denied'
  const failed = info.status === 'error' || declined
  const needsAttention = !failed && deviceNeedsAttention(info)
  const tone: ToolRowTone = declined ? 'denied' : info.status === 'error' ? 'error'
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
    ? (info.errorText || description)
    : description || deviceInputSummary(op, params) || toolSummary?.trim() || ''

  const status = !isStreaming && !failed ? statusText(op, info, t) : null
  const hasScreenshot = !!info.imagePath && !isStreaming && !failed
  const hasCatalog = op === 'list' && !isStreaming && !failed && (info.groups?.length ?? 0) > 0
  // A rendered body is the reading; the raw JSON stays one more click away rather
  // than competing with it.
  const rich = hasScreenshot || hasCatalog || !!recording
  const hasResultJson = !isStreaming && !!result
  // `reason` explains a didnt; without it the user sees a warning row and no cause.
  const explanation = info.failure || (info.outcome === 'didnt' ? info.reason : undefined)
  // The control request's whole story is its header -- the permission prompt already
  // showed the user what they were approving, and the result body is prose written
  // for the agent. A refusal is the exception: its reason has to be readable
  // somewhere, and the header truncates.
  const expandable = !isStreaming && !!result
    && ((op !== 'request_control' && op !== 'boot') || failed)

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
          {expanded && hasCatalog && info.groups && <DeviceCatalog groups={info.groups} />}
          {expanded && recording}
          {expanded && hasScreenshot && info.imagePath && (
            renderScreenshot?.(
              info.imagePath,
              t('chat.toolBlock.device.screenshot'),
              t('chat.toolBlock.device.screenshotUnavailable'),
            ) ?? (
              <ToolScreenshotViewPresenter
                path={info.imagePath}
                label={t('chat.toolBlock.device.screenshot')}
                unavailableLabel={t('chat.toolBlock.device.screenshotUnavailable')}
              />
            )
          )}
          {expanded && rich && hasResultJson && result && (
            <div className="rounded bg-muted/30">
              <CollapsedJsonRow
                expanded={jsonExpanded}
                onToggle={() => setJsonExpanded((value) => !value)}
                label={t('chat.toolBlock.device.json')}
              />
              {jsonExpanded && (
                <div className="px-1 pb-1">
                  {renderJson(result)}
                </div>
              )}
            </div>
          )}
          {expanded && !rich && result && renderJson(result)}
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
          {recording && (
            <Video className="size-3 text-muted-foreground/70" aria-label="Action recording" />
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
            <span className={cn('transition-colors duration-500', elapsedClassName ?? 'text-muted-foreground')}>
              {Math.round(elapsedSeconds)}s
            </span>
          )}
        </div>
      )}
    >
      <ToolName streaming={isStreaming && !declined} tone={tone}>
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
 * The catalog `device_list` returned, as something a person can pick from.
 *
 * Running comes first from the tool and stays first here, because attaching to a
 * booted simulator is instant while a cold one costs a ~20s boot -- so the order is
 * information, not decoration, and re-sorting it in the UI would throw that away.
 */
/**
 * Headings the tool does not send.
 *
 * The kind and model tiers head their group with a name from the payload — "iPhone",
 * "iPhone 17 Pro Max" — which is already the right word in any language. The overview
 * groups things by why they are worth offering, and that has to be translated.
 */
const GROUP_LABEL_KEYS: Record<string, string | undefined> = {
  running: 'chat.toolBlock.device.running',
  recent: 'chat.toolBlock.device.recentlyUsed',
}

function DeviceCatalog({ groups }: { groups: DeviceListGroup[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <span className="font-medium uppercase tracking-wide text-muted-foreground/70">
            {GROUP_LABEL_KEYS[group.id] ? t(GROUP_LABEL_KEYS[group.id]!) : group.name}
          </span>
          {group.devices.map((device) => (
            <div key={device.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  device.running ? 'bg-success' : 'bg-muted-foreground/30',
                )}
                aria-label={t(device.running
                  ? 'chat.toolBlock.device.running'
                  : 'chat.toolBlock.device.stopped')}
              />
              <span className="min-w-0 truncate text-foreground">{device.name}</span>
              {device.platform && (
                <span className="shrink-0 text-muted-foreground/70">{device.platform}</span>
              )}
              {device.controlled && (
                <span className="shrink-0 text-primary">{t('chat.toolBlock.device.controlled')}</span>
              )}
              {device.busy && (
                <span className="shrink-0 text-warning">{t('chat.toolBlock.device.busy')}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
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
  if (op === 'list') {
    if (info.deviceCount == null) return ''
    return info.deviceCount === 0
      ? t('chat.toolBlock.device.noDevices')
      : t('chat.toolBlock.device.deviceCount', { count: info.deviceCount })
  }
  if (op === 'boot') {
    // Same reading as request_control, one state further back: which device, and
    // whether anything actually had to start. "Already running" is why a call the
    // user expected to take 20s came back instantly.
    return [
      info.device,
      info.alreadyRunning ? t('chat.toolBlock.device.alreadyRunning') : '',
    ].filter(Boolean).join(' · ')
  }
  if (op === 'request_control') {
    // The device name, not a word about the outcome: which device was handed over is
    // the one thing the label cannot say and the user cannot infer.
    return [
      info.device,
      info.alreadyControlled ? t('chat.toolBlock.device.alreadyControlled') : '',
    ].filter(Boolean).join(' · ')
  }
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
