import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import type { ConfigFieldType } from '@superone/shared/agent-types'
import {
  PROTOCOL_FAMILY,
  type EndpointModel,
  type PlanCapabilities,
  type ProtocolFamily,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { ExpandableToolRow, toolOutcomeLabel, withStreamingEllipsis, type ToolRowTone } from './ToolRow'

type ConfigAppliedChange = {
  key?: string
  label?: string
  type?: ConfigFieldType
  oldValue?: unknown
  newValue?: unknown
}

const FAMILY_LABEL: Record<ProtocolFamily, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  volcengine: 'Volcengine',
  newapi: 'New API',
  google: 'Google',
}

function asMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asModels(value: unknown): EndpointModel[] {
  return Array.isArray(value) ? value as EndpointModel[] : []
}

function slotText(value: unknown): string {
  const slot = asMap(value)
  const id = typeof slot.id === 'string' ? slot.id : ''
  const name = typeof slot.name === 'string' ? slot.name : ''
  return id || name || String(value)
}

function capabilitiesText(value: unknown): string {
  const capabilities = value as PlanCapabilities | undefined
  if (!capabilities?.protocols?.length) return ''
  const byFamily = new Map<ProtocolFamily, WireProtocol[]>()
  for (const protocol of capabilities.protocols) {
    const family = PROTOCOL_FAMILY[protocol]
    byFamily.set(family, [...(byFamily.get(family) ?? []), protocol])
  }
  return [...byFamily]
    .map(([family, protocols]) => `${FAMILY_LABEL[family]} · ${protocols.join(', ')}`)
    .join(' / ')
}

function formatValue(type: ConfigFieldType, value: unknown, emptyLabel: string): string {
  if (value === null || value === undefined || value === '') return emptyLabel
  if (type === 'boolean') return value ? 'on' : 'off'
  if (type === 'env') {
    const entries = Object.entries(asMap(value))
    return entries.length ? entries.map(([key, item]) => `${key}=${String(item)}`).join(', ') : emptyLabel
  }
  if (type === 'model-mapping') {
    const entries = Object.entries(asMap(value))
    return entries.length ? entries.map(([key, item]) => `${key}: ${slotText(item)}`).join(', ') : emptyLabel
  }
  if (type === 'models') {
    const models = asModels(value)
    return models.length ? models.map((model) => model.name || model.id).join(', ') : emptyLabel
  }
  if (type === 'capabilities') {
    return capabilitiesText(value) || emptyLabel
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function listDiff(previous: string[], next: string[]): string[] {
  return [
    ...next.filter((value) => !previous.includes(value)).map((value) => `+${value}`),
    ...previous.filter((value) => !next.includes(value)).map((value) => `−${value}`),
  ]
}

function mapDiff(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  render: (value: unknown) => string,
): string[] {
  const changes: string[] = []
  for (const [key, value] of Object.entries(next)) {
    if (!(key in previous)) changes.push(`+${key} ${render(value)}`)
    else if (render(previous[key]) !== render(value)) {
      changes.push(`${key} ${render(previous[key])} → ${render(value)}`)
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in next)) changes.push(`−${key}`)
  }
  return changes
}

function diffValue(type: ConfigFieldType, previous: unknown, next: unknown): string | null {
  if (type === 'env') return mapDiff(asMap(previous), asMap(next), String).join(', ') || null
  if (type === 'model-mapping') return mapDiff(asMap(previous), asMap(next), slotText).join(', ') || null
  if (type === 'models') {
    return listDiff(asModels(previous).map((model) => model.id), asModels(next).map((model) => model.id)).join(', ') || null
  }
  if (type === 'capabilities') {
    const parts = (value: unknown) => {
      const capabilities = value as PlanCapabilities | undefined
      return capabilities?.protocols?.map(
        (protocol) => `${FAMILY_LABEL[PROTOCOL_FAMILY[protocol]]}·${protocol}`,
      ) ?? []
    }
    return listDiff(parts(previous), parts(next)).join(', ') || null
  }
  return null
}

function toolRowTone(isDenied: boolean, isError: boolean): ToolRowTone {
  if (isDenied) return 'denied'
  if (isError) return 'error'
  return 'default'
}

export interface ConfigApplyBlockPresenterProps {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
  isError: boolean
  isDenied: boolean
  allowExpand: boolean
}

export function ConfigApplyBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand,
}: ConfigApplyBlockPresenterProps) {
  const { t } = useTranslation()
  const emptyLabel = t('chat.configConfirm.emptyValue')
  const parsed = useMemo<Record<string, unknown> | null>(() => {
    if (!result) return null
    try {
      const value = JSON.parse(result)
      return value && typeof value === 'object' ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }, [result])

  const status = typeof parsed?.status === 'string' ? parsed.status : undefined
  const rows = useMemo(() => {
    const applied = Array.isArray(parsed?.applied) ? parsed.applied as ConfigAppliedChange[] : null
    if (applied?.length) {
      return applied.map((change) => {
        const type = change.type ?? 'string'
        const diff = 'oldValue' in change ? diffValue(type, change.oldValue, change.newValue) : null
        return {
          key: String(change.key ?? ''),
          label: change.label ?? String(change.key ?? ''),
          diff,
          from: diff || !('oldValue' in change) ? null : formatValue(type, change.oldValue, emptyLabel),
          to: diff ? null : formatValue(type, change.newValue, emptyLabel),
        }
      })
    }
    const changes = Array.isArray(params.changes)
      ? params.changes as Array<{ key?: string; value?: unknown }>
      : null
    return changes?.map((change) => ({
      key: String(change.key ?? ''),
      label: String(change.key ?? ''),
      diff: null,
      from: null,
      to: formatValue('string', change.value, emptyLabel),
    })) ?? []
  }, [emptyLabel, params, parsed])

  const resource = params.resource && typeof params.resource === 'object'
    ? params.resource as { operation?: string }
    : undefined
  const operation = typeof parsed?.operation === 'string' ? parsed.operation : resource?.operation
  const title = typeof parsed?.title === 'string' ? parsed.title : undefined
  const failed = isError || status === 'error'
  const rejected = isDenied || status === 'rejected' || status === 'cancelled'
  const tone = toolRowTone(rejected, failed)
  const actionLabel = operation === 'delete'
    ? t('chat.toolBlock.deleteSettings')
    : operation === 'create'
      ? t('chat.toolBlock.createSettings')
      : t('chat.toolBlock.updateSettings')
  const doneLabel = operation === 'delete'
    ? t('chat.toolBlock.configDeleted')
    : operation === 'create'
      ? t('chat.toolBlock.configCreated')
      : operation === 'update'
        ? t('chat.toolBlock.configUpdated')
        : t('chat.toolBlock.appliedSettings')
  const label = withStreamingEllipsis(toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: rejected || failed,
    streamingLabel: t('chat.toolBlock.applyingSettings'),
    actionLabel,
    doneLabel,
  }), isStreaming)
  const summary = title ?? (rows.length ? t('chat.toolBlock.settingsChangeCount', { count: rows.length }) : '')
  const errorMessage = failed && typeof parsed?.message === 'string' ? parsed.message : ''

  return (
    <ExpandableToolRow
      icon={<SlidersHorizontal className="size-3 shrink-0 text-muted-foreground" />}
      label={label}
      summary={summary || undefined}
      streaming={isStreaming}
      tone={tone}
      expandable={allowExpand && (rows.length > 0 || !!errorMessage)}
    >
      <div className="space-y-1.5">
        {errorMessage ? <div className="mb-1 text-warning">{errorMessage}</div> : null}
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline gap-2">
            <span className="w-32 shrink-0 truncate text-muted-foreground" title={row.label}>{row.label}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5">
              {row.diff ? (
                <span className="break-all font-medium text-foreground">{row.diff}</span>
              ) : (
                <>
                  {row.from !== null ? (
                    <>
                      <span className="text-muted-foreground/60 line-through">{row.from}</span>
                      <span className="text-muted-foreground/50">→</span>
                    </>
                  ) : null}
                  <span className="break-all font-medium text-foreground">{row.to}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </ExpandableToolRow>
  )
}
