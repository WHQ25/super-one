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

export function ToolStatusIcon({ tone, fallback }: { tone: ToolRowTone; fallback: ReactNode }) {
  if (tone === 'denied') return <Ban className="size-3 shrink-0 text-error" />
  if (tone === 'error' || tone === 'warning') {
    return <TriangleAlert className="size-3 shrink-0 text-warning" />
  }
  return fallback
}

export function ToolStatusBadge({ tone }: { tone: ToolRowTone }) {
  const { t } = useTranslation()
  if (tone === 'denied') {
    return <span className="shrink-0 rounded bg-error/20 px-1 py-px text-xs text-error">{t('chat.toolBlock.denied')}</span>
  }
  if (tone === 'error') {
    return <span className="shrink-0 rounded bg-warning/20 px-1 py-px text-xs text-warning">{t('chat.toolBlock.error')}</span>
  }
  return null
}

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
    <span className={cn(
      'shrink-0 whitespace-nowrap font-medium',
      toolNameToneClass(tone),
      streaming && tone !== 'denied' && 'animate-shimmer',
      className,
    )}>
      {children}
    </span>
  )
}

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
  return <span className={cn('min-w-0 truncate text-muted-foreground', className)} title={resolvedTitle}>{children}</span>
}

export interface ToolRowProps {
  icon: ReactNode
  children: ReactNode
  details?: ReactNode
  expandable?: boolean
  tone?: ToolRowTone
  className?: string
  headerClassName?: string
  detailsClassName?: string
  trailing?: ReactNode
  iconIsIdentity?: boolean
  showStatusBadge?: boolean
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  mountDetails?: 'always' | 'expanded'
}

/** Shared Tool UI shell. Hosts provide semantics and detail content through props. */
export function ToolRow({
  icon,
  children,
  details,
  expandable = false,
  tone = 'default',
  className,
  headerClassName,
  detailsClassName = 'border-t border-border/40 px-2 py-2 text-xs',
  trailing,
  iconIsIdentity = false,
  showStatusBadge = true,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  mountDetails = 'always',
}: ToolRowProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded)
  const expanded = controlledExpanded ?? uncontrolledExpanded
  const canExpand = expandable && details !== undefined && details !== null

  const toggle = (): void => {
    if (!canExpand) return
    const next = !expanded
    if (controlledExpanded === undefined) setUncontrolledExpanded(next)
    onExpandedChange?.(next)
  }

  return (
    <div className={cn(toolRowSurfaceClass(tone, canExpand), className)}>
      <div
        className={cn('flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs', headerClassName)}
        onClick={canExpand ? toggle : undefined}
      >
        {iconIsIdentity ? icon : <ToolStatusIcon tone={tone} fallback={icon} />}
        {children}
        {showStatusBadge ? <ToolStatusBadge tone={tone} /> : null}
        {trailing}
        {canExpand ? (
          <ChevronRight className={cn(
            'ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-90',
          )} />
        ) : null}
      </div>
      {canExpand ? (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {mountDetails === 'always' || expanded ? <div className={detailsClassName}>{details}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
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
  return <ToolRow icon={icon} tone={tone} className={className} showStatusBadge={false}>{children}</ToolRow>
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
    <ToolRow icon={icon} tone={tone}>
      <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
      {children}
    </ToolRow>
  )
}

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
  const canExpand = Boolean(expandable && children)
  return (
    <ToolRow icon={icon} tone={tone} expandable={canExpand} details={children}>
      <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary title={typeof summary === 'string' ? summary : undefined}>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}

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

export function withStreamingEllipsis(label: string, streaming: boolean): string {
  if (!streaming) return label
  return /[.…]$/.test(label) ? label : `${label}…`
}
