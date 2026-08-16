import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export type ToolRowTone = 'default' | 'error' | 'warning' | 'denied'

export function toolNameToneClass(tone: ToolRowTone): string {
  if (tone === 'denied') return 'text-error'
  if (tone === 'error' || tone === 'warning') return 'text-warning'
  return 'text-foreground'
}

/** Shared denied / error / default surface — matches Bash / Read / Browser. */
export function toolRowSurfaceClass(tone: ToolRowTone, expandable?: boolean): string {
  return cn(
    'tool-node my-0.5 min-w-0 rounded transition-colors',
    tone === 'error' && 'errored bg-warning/10',
    tone === 'warning' && 'bg-warning/10',
    tone === 'denied' && 'denied bg-error/10',
    tone === 'default' && 'bg-muted/20',
    expandable && 'cursor-pointer',
    expandable && tone === 'default' && 'hover:bg-muted/40',
    expandable && (tone === 'error' || tone === 'warning') && 'hover:bg-warning/20',
    expandable && tone === 'denied' && 'hover:bg-error/20',
  )
}

export function ToolStatusIcon({
  tone,
  fallback,
}: {
  tone: ToolRowTone
  fallback: ReactNode
}) {
  if (tone === 'denied') return <Ban className="size-3 shrink-0 text-error" />
  if (tone === 'error' || tone === 'warning') {
    return <TriangleAlert className="size-3 shrink-0 text-warning" />
  }
  return fallback
}

export function ToolStatusBadge({ tone }: { tone: ToolRowTone }) {
  const { t } = useTranslation()
  if (tone === 'denied') {
    return (
      <span className="shrink-0 rounded bg-error/20 px-1 py-px text-xs text-error">
        {t('chat.toolBlock.denied')}
      </span>
    )
  }
  if (tone === 'error') {
    return (
      <span className="shrink-0 rounded bg-warning/20 px-1 py-px text-xs text-warning">
        {t('chat.toolBlock.error')}
      </span>
    )
  }
  return null
}

/** Running tool titles shimmer like Bash. Denied rows stay solid. */
export function ToolName({
  children,
  streaming = false,
  tone = 'default',
  className,
}: {
  children: ReactNode
  streaming?: boolean
  tone?: ToolRowTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap font-medium',
        toolNameToneClass(tone),
        streaming && tone !== 'denied' && 'animate-shimmer',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Grey summary after the tool name. Space-separated — never a colon. */
export function ToolSummary({
  children,
  title,
  className,
}: {
  children: ReactNode
  title?: string
  className?: string
}) {
  const resolvedTitle = title ?? (typeof children === 'string' ? children : undefined)
  return (
    <span className={cn('min-w-0 truncate text-muted-foreground', className)} title={resolvedTitle}>
      {children}
    </span>
  )
}

export function CompactToolRow({
  icon,
  children,
  className,
  tone = 'default',
}: {
  icon: ReactNode
  children: ReactNode
  className?: string
  tone?: ToolRowTone
}) {
  return (
    <div className={cn(toolRowSurfaceClass(tone), className)}>
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs">
        <ToolStatusIcon tone={tone} fallback={icon} />
        {children}
      </div>
    </div>
  )
}

export function CompactLabeledToolRow({
  icon,
  label,
  summary,
  streaming = false,
  tone = 'default',
  children,
}: {
  icon: ReactNode
  label: ReactNode
  summary?: ReactNode
  streaming?: boolean
  tone?: ToolRowTone
  children?: ReactNode
}) {
  return (
    <CompactToolRow icon={icon} tone={tone}>
      <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
      <ToolStatusBadge tone={tone} />
      {children}
    </CompactToolRow>
  )
}

/** Expandable header used by archive / automation (and any future SuperOne row). */
export function ExpandableToolRow({
  icon,
  label,
  summary,
  streaming = false,
  expandable,
  children,
  tone = 'default',
}: {
  icon: ReactNode
  label: ReactNode
  summary?: ReactNode
  streaming?: boolean
  expandable?: boolean
  children?: ReactNode
  tone?: ToolRowTone
}) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = !!expandable && !!children
  const summaryTitle = typeof summary === 'string' ? summary : undefined

  return (
    <div className={toolRowSurfaceClass(tone, canExpand)}>
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
      >
        <ToolStatusIcon tone={tone} fallback={icon} />
        <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
        {summary ? (
          <ToolSummary title={summaryTitle}>{summary}</ToolSummary>
        ) : null}
        <ToolStatusBadge tone={tone} />
        {canExpand ? (
          <ChevronRight
            className={cn(
              'ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
        ) : null}
      </div>
      {canExpand ? (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border/40 px-2 py-2 text-xs">{children}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Header grammar:
 * - running: sentence-case verb-ing
 * - done: noun + past participle
 * - denied / error: verb + noun (the badge carries the outcome)
 */
export function toolOutcomeLabel({
  streaming,
  interrupted,
  streamingLabel,
  actionLabel,
  doneLabel,
}: {
  streaming: boolean
  interrupted?: boolean
  streamingLabel: string
  actionLabel: string
  doneLabel: string
}): string {
  if (streaming) return streamingLabel
  if (interrupted) return actionLabel
  return doneLabel
}

/** Append … for running labels that do not already end with an ellipsis. */
export function withStreamingEllipsis(label: string, streaming: boolean): string {
  if (!streaming) return label
  return /[.…]$/.test(label) ? label : `${label}…`
}
