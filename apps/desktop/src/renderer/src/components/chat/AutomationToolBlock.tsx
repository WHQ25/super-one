/**
 * Chat tool UI for SuperOne automation MCP tools:
 * automation_list / automation_apply / automation_delete
 *
 * Label casing mirrors collab / archive:
 * - Streaming: sentence case + …
 * - Done primary: Title Case (EN)
 */

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Ban,
  CalendarClock,
  ChevronRight,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { decode as toonDecode } from '@toon-format/toon'

/** Product glyph for all automation tool rows (sidebar / confirm parity). */
function AutomationIcon({ className }: { className?: string }) {
  return <CalendarClock className={cn('size-3 shrink-0 text-muted-foreground', className)} />
}

export type AutomationToolName = 'automation_list' | 'automation_apply' | 'automation_delete'

export interface AutomationToolBlockProps {
  toolName: AutomationToolName
  params: Record<string, unknown>
  result?: string | null
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function tryParseJson(text: string | null | undefined): unknown {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function tryParseToon(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return toonDecode(text)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseResult(text: string | null | undefined): Record<string, unknown> | null {
  return asRecord(tryParseJson(text)) ?? asRecord(tryParseToon(text))
}

function Row({
  icon,
  label,
  summary,
  tone = 'default',
  expandable,
  children,
}: {
  icon: ReactNode
  label: string
  summary?: string
  tone?: 'default' | 'error' | 'warning' | 'denied'
  expandable?: boolean
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = !!expandable && !!children

  return (
    <div
      className={cn(
        'tool-node my-0.5 min-w-0 rounded transition-colors',
        tone === 'error' && 'errored bg-warning/10',
        tone === 'warning' && 'bg-warning/10',
        tone === 'denied' && 'denied bg-error/10',
        tone === 'default' && 'bg-muted/20',
        canExpand && 'cursor-pointer',
        canExpand && tone === 'default' && 'hover:bg-muted/40',
        canExpand && tone === 'error' && 'hover:bg-warning/20',
        canExpand && tone === 'denied' && 'hover:bg-error/20',
      )}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
      >
        {icon}
        <span
          className={cn(
            'shrink-0 whitespace-nowrap font-medium',
            tone === 'denied' ? 'text-error' : tone === 'error' ? 'text-warning' : 'text-foreground',
          )}
        >
          {label}
        </span>
        {summary ? (
          <span className="min-w-0 truncate text-muted-foreground" title={summary}>
            {summary}
          </span>
        ) : null}
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
 * Default glyph is always CalendarClock (automation brand).
 * Denied / user-rejected / cancelled → Ban; hard errors → TriangleAlert.
 */
function StatusIcon({ tone }: { tone: 'default' | 'error' | 'warning' | 'denied' }) {
  if (tone === 'denied') return <Ban className="size-3 shrink-0 text-error" />
  if (tone === 'error' || tone === 'warning') {
    return <TriangleAlert className="size-3 shrink-0 text-warning" />
  }
  return <AutomationIcon />
}

function resultTone(
  isDenied: boolean,
  isError: boolean,
  resultStatus?: string,
): 'default' | 'error' | 'warning' | 'denied' {
  if (isDenied) return 'denied'
  if (resultStatus === 'rejected' || resultStatus === 'cancelled') return 'denied'
  if (isError || resultStatus === 'error') return 'error'
  return 'default'
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-foreground">{value}</span>
    </div>
  )
}

function ListBody({
  rows,
  fields,
}: {
  rows: Array<Record<string, unknown>>
  fields: { name: string; schedule: string; status: string; enabled: string; disabled: string }
}) {
  if (rows.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const name = typeof r.name === 'string' ? r.name : '—'
        const schedule = typeof r.schedule === 'string'
          ? r.schedule
          : typeof r.scheduleSummary === 'string'
            ? r.scheduleSummary
            : ''
        const enabled = r.enabled === true
        const status = typeof r.lastRunStatus === 'string' ? r.lastRunStatus : ''
        return (
          <li key={typeof r.id === 'string' ? r.id : i} className="rounded bg-muted/30 px-2 py-1.5">
            <div className="font-medium text-foreground">{name}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>{enabled ? fields.enabled : fields.disabled}</span>
              {schedule ? <span>{fields.schedule}: {schedule}</span> : null}
              {status ? <span>{fields.status}: {status}</span> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function AutomationToolBlock({
  toolName,
  params,
  result,
  isStreaming = false,
  isError = false,
  isDenied = false,
  allowExpand = true,
}: AutomationToolBlockProps) {
  const { t } = useTranslation()
  const a = 'chat.toolBlock.automation'
  const rec = parseResult(result)
  const resultStatus = typeof rec?.status === 'string' ? rec.status : ''
  const tone = resultTone(isDenied, isError, resultStatus)
  const deniedLabel = t('chat.toolBlock.denied')
  const canShowExpand = allowExpand !== false

  const fieldLabels = {
    name: t(`${a}.fields.name`),
    schedule: t(`${a}.fields.schedule`),
    status: t(`${a}.fields.status`),
    enabled: t(`${a}.enabled`),
    disabled: t(`${a}.disabled`),
    prompt: t(`${a}.fields.prompt`),
    agent: t(`${a}.fields.agent`),
  }

  // ---------- automation_list ----------
  if (toolName === 'automation_list') {
    const detail = asRecord(rec?.automation)
    const rows = detail
      ? [detail]
      : asArray(rec?.automations).map((r) => asRecord(r) ?? {})
    const count = typeof rec?.count === 'number'
      ? rec.count
      : typeof rec?.total === 'number'
        ? rec.total
        : rows.length
    const query = typeof params.query === 'string' ? params.query : ''
    const id = typeof params.id === 'string' ? params.id : ''

    let label = t(`${a}.automationsListed`)
    let summary: string | undefined

    if (isDenied || resultStatus === 'rejected' || resultStatus === 'cancelled') {
      label = t(`${a}.listFailed`)
      summary = deniedLabel
    } else if (isStreaming) {
      label = id ? t(`${a}.readingAutomation`) : t(`${a}.listingAutomations`)
      if (query) summary = `“${query}”`
    } else if (isError || resultStatus === 'error') {
      label = t(`${a}.listFailed`)
      summary = typeof rec?.message === 'string' ? rec.message : undefined
    } else if (detail) {
      label = t(`${a}.automationDetail`)
      summary = typeof detail.name === 'string' ? detail.name : undefined
    } else {
      label = t(`${a}.automationsListed`)
      summary = count === 0
        ? t(`${a}.empty`)
        : t(`${a}.automationCount`, { count })
    }

    const expandable = canShowExpand && tone === 'default' && rows.length > 0

    return (
      <Row
        icon={<StatusIcon tone={tone} />}
        label={label}
        summary={summary}
        tone={tone}
        expandable={expandable}
      >
        {detail ? (
          <div className="space-y-1">
            {typeof detail.name === 'string' ? <FieldRow label={fieldLabels.name} value={detail.name} /> : null}
            {typeof detail.scheduleSummary === 'string' || typeof detail.schedule === 'string' ? (
              <FieldRow
                label={fieldLabels.schedule}
                value={
                  typeof detail.scheduleSummary === 'string'
                    ? detail.scheduleSummary
                    : formatLooseSchedule(detail.schedule)
                }
              />
            ) : null}
            {asRecord(detail.agentConfig)?.type ? (
              <FieldRow label={fieldLabels.agent} value={String(asRecord(detail.agentConfig)!.type)} />
            ) : null}
            {typeof detail.prompt === 'string' ? (
              <FieldRow
                label={fieldLabels.prompt}
                value={detail.prompt.length > 200 ? `${detail.prompt.slice(0, 200)}…` : detail.prompt}
              />
            ) : null}
          </div>
        ) : (
          <ListBody rows={rows} fields={fieldLabels} />
        )}
      </Row>
    )
  }

  // ---------- automation_apply ----------
  if (toolName === 'automation_apply') {
    const action = typeof params.action === 'string' ? params.action : String(rec?.action ?? 'create')
    const auto = asRecord(rec?.automation)
    const nameFromResult = typeof auto?.name === 'string' ? auto.name : ''
    const nameFromParams = typeof params.name === 'string' ? params.name : ''
    const name = nameFromResult || nameFromParams
    const enabledOnly =
      action === 'update'
      && typeof params.enabled === 'boolean'
      && params.name === undefined
      && params.prompt === undefined
      && params.schedule === undefined
      && params.agentConfig === undefined

    /** create | update | enable | disable — drives Title Case done/reject labels. */
    const applyKind: 'create' | 'update' | 'enable' | 'disable' = enabledOnly
      ? (params.enabled === false ? 'disable' : 'enable')
      : action === 'update'
        ? 'update'
        : 'create'
    const rejectLabelKey = {
      create: `${a}.createRejected`,
      update: `${a}.updateRejected`,
      enable: `${a}.enableRejected`,
      disable: `${a}.disableRejected`,
    }[applyKind]
    const cancelLabelKey = {
      create: `${a}.createCancelled`,
      update: `${a}.updateCancelled`,
      enable: `${a}.enableCancelled`,
      disable: `${a}.disableCancelled`,
    }[applyKind]
    const failedLabelKey = {
      create: `${a}.createFailed`,
      update: `${a}.updateFailed`,
      enable: `${a}.enableFailed`,
      disable: `${a}.disableFailed`,
    }[applyKind]

    let label = action === 'update' ? t(`${a}.automationUpdated`) : t(`${a}.automationCreated`)
    let summary: string | undefined = name || undefined

    if (isDenied || resultStatus === 'rejected') {
      // User denied HITL — name the action, not generic "Apply Rejected".
      label = t(rejectLabelKey)
      if (name) summary = name
    } else if (isStreaming) {
      // Full tool call includes HITL confirm — streaming = waiting for user or apply.
      if (enabledOnly) {
        label = params.enabled === false ? t(`${a}.confirmingDisable`) : t(`${a}.confirmingEnable`)
      } else {
        label = action === 'update' ? t(`${a}.confirmingUpdate`) : t(`${a}.confirmingCreate`)
      }
      if (name) summary = name
    } else if (isError || resultStatus === 'error') {
      label = t(failedLabelKey)
      summary = typeof rec?.message === 'string' ? rec.message : name || undefined
    } else if (resultStatus === 'cancelled') {
      label = t(cancelLabelKey)
      if (name) summary = name
    } else if (enabledOnly) {
      const on = auto?.enabled === true || params.enabled === true
      label = on ? t(`${a}.automationEnabled`) : t(`${a}.automationDisabled`)
    }

    const expandable =
      canShowExpand
      && tone === 'default'
      && !!auto
      && (typeof auto.prompt === 'string' || typeof auto.scheduleSummary === 'string')

    return (
      <Row
        icon={<StatusIcon tone={tone} />}
        label={label}
        summary={summary}
        tone={tone}
        expandable={expandable}
      >
        {auto ? (
          <div className="space-y-1">
            {typeof auto.name === 'string' ? <FieldRow label={fieldLabels.name} value={auto.name} /> : null}
            {typeof auto.scheduleSummary === 'string' ? (
              <FieldRow label={fieldLabels.schedule} value={auto.scheduleSummary} />
            ) : null}
            {asRecord(auto.agentConfig)?.type ? (
              <FieldRow label={fieldLabels.agent} value={String(asRecord(auto.agentConfig)!.type)} />
            ) : null}
            {typeof auto.prompt === 'string' ? (
              <FieldRow
                label={fieldLabels.prompt}
                value={auto.prompt.length > 200 ? `${auto.prompt.slice(0, 200)}…` : auto.prompt}
              />
            ) : null}
          </div>
        ) : null}
      </Row>
    )
  }

  // ---------- automation_delete ----------
  const deleted = asArray(rec?.deleted).map((d) => asRecord(d) ?? {})
  const failed = asArray(rec?.failed).map((d) => asRecord(d) ?? {})
  const idCount = Array.isArray(params.ids) ? params.ids.length : 0

  let label = t(`${a}.automationsDeleted`)
  let summary: string | undefined

  if (isDenied) {
    label = t(`${a}.deleteRejected`)
    summary = deniedLabel
  } else if (isStreaming) {
    label = t(`${a}.confirmingDelete`)
    if (idCount > 0) summary = t(`${a}.automationCount`, { count: idCount })
  } else if (isError || resultStatus === 'error') {
    label = t(`${a}.deleteFailed`)
    summary = typeof rec?.message === 'string'
      ? rec.message
      : failed.length > 0
        ? t(`${a}.automationCount`, { count: failed.length })
        : undefined
  } else if (resultStatus === 'cancelled') {
    label = t(`${a}.deleteCancelled`)
  } else if (resultStatus === 'rejected') {
    label = t(`${a}.deleteRejected`)
  } else if (resultStatus === 'not_found') {
    label = t(`${a}.nothingDeleted`)
    summary = typeof rec?.message === 'string' ? rec.message : t(`${a}.empty`)
  } else if (resultStatus === 'partial') {
    label = t(`${a}.automationsDeletedPartial`)
    summary = t(`${a}.partialDeleteSummary`, {
      deleted: deleted.length,
      failed: failed.length,
    })
  } else {
    label = t(`${a}.automationsDeleted`)
    // Prefer actual deleted count — never fall back to requested ids (looks like success when none matched).
    summary = t(`${a}.automationCount`, { count: deleted.length })
  }

  const expandable =
    canShowExpand
    && tone === 'default'
    && (deleted.length > 0 || failed.length > 0)

  return (
    <Row
      icon={<StatusIcon tone={tone} />}
      label={label}
      summary={summary}
      tone={tone}
      expandable={expandable}
    >
      <div className="space-y-2">
        {deleted.length > 0 ? (
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t(`${a}.deletedSection`)}</div>
            <ul className="space-y-0.5">
              {deleted.map((d, i) => (
                <li key={typeof d.id === 'string' ? d.id : i} className="text-foreground">
                  {typeof d.name === 'string' ? d.name : typeof d.id === 'string' ? d.id : '—'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {failed.length > 0 ? (
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t(`${a}.failedSection`)}</div>
            <ul className="space-y-0.5">
              {failed.map((d, i) => (
                <li key={typeof d.id === 'string' ? d.id : i} className="text-warning">
                  {typeof d.name === 'string' ? d.name : '—'}
                  {typeof d.error === 'string' ? ` — ${d.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Row>
  )
}

function formatLooseSchedule(schedule: unknown): string {
  const rec = asRecord(schedule)
  if (!rec) return ''
  if (typeof rec.cron === 'string') return `cron ${rec.cron}`
  if (typeof rec.runAt === 'string') return `once @ ${rec.runAt}`
  if (typeof rec.preset === 'string') return rec.preset
  return typeof rec.type === 'string' ? rec.type : ''
}

export function isAutomationToolName(name: string): name is AutomationToolName {
  return name === 'automation_list' || name === 'automation_apply' || name === 'automation_delete'
}
