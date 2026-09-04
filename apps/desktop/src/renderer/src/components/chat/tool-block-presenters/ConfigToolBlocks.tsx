import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ConfigFieldType } from '@superone/shared/agent-types'
import { diffConfigFieldValue, formatConfigFieldValue } from '../../../lib/config-field-summary'
import { ToolIcon } from '../ToolIcon'
import { ToolErrorText } from '../tool-result-views'
import {
  ExpandableToolRow,
  toolOutcomeLabel,
  withStreamingEllipsis,
  type ToolRowTone,
} from '../tool-row'

function toolRowTone(isDenied?: boolean, isError?: boolean): ToolRowTone {
  if (isDenied) return 'denied'
  if (isError) return 'error'
  return 'default'
}

export function SetupMiniAppDevBlock({ appName, isStreaming, params, result, isDenied, isError, allowExpand }: {
  appName: string
  isStreaming: boolean
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  isDenied?: boolean
  isError?: boolean
  allowExpand: boolean
}) {
  const { t } = useTranslation()
  const errored = !!isError || (!!result && result.status === 'error')
  const tone = toolRowTone(isDenied, errored)
  const headerLabel = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted: !!isDenied || errored,
    streamingLabel: t('chat.toolBlock.settingUpMiniApp'),
    actionLabel: t('chat.toolBlock.setupMiniApp'),
    doneLabel: t('chat.toolBlock.setUpMiniApp'),
  })
  const appId = result?.appId ? String(result.appId) : ''
  const directory = params.directory ? String(params.directory) : ''
  const description = params.description ? String(params.description) : ''
  const errorMsg = errored ? String((result?.message as string | undefined) ?? '') : ''
  const rows: Array<{ key: string; label: string; value: string; mono?: boolean }> = []
  if (appId) rows.push({ key: 'appId', label: t('chat.toolBlock.setupFields.appId'), value: appId, mono: true })
  if (directory) rows.push({ key: 'directory', label: t('chat.toolBlock.setupFields.directory'), value: directory, mono: true })
  if (description) rows.push({ key: 'description', label: t('chat.toolBlock.setupFields.description'), value: description })
  return (
    <ExpandableToolRow
      icon={<ToolIcon icon="file-plus" className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(headerLabel, isStreaming)}
      summary={appName || undefined}
      streaming={isStreaming}
      tone={tone}
      expandable={allowExpand && (rows.length > 0 || !!errorMsg)}
    >
      <div className="space-y-1">
        {errorMsg ? (
          <ToolErrorText className="mb-2">{errorMsg}</ToolErrorText>
        ) : null}
        {rows.map(({ key, label, value, mono }) => (
          <div key={key} className="flex items-baseline gap-2">
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            <span className={cn('min-w-0 flex-1 break-all text-foreground', mono && 'font-mono')}>{value}</span>
          </div>
        ))}
      </div>
    </ExpandableToolRow>
  )
}

type ConfigAppliedChange = { key?: string; label?: string; type?: ConfigFieldType; oldValue?: unknown; newValue?: unknown }

export function ConfigApplyBlock({ params, result, isStreaming, isError, isDenied, allowExpand }: {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
  isError: boolean
  isDenied: boolean
  allowExpand: boolean
}) {
  const { t } = useTranslation()
  const emptyLabel = t('chat.configConfirm.emptyValue')

  const parsed = useMemo<Record<string, unknown> | null>(() => {
    if (!result) return null
    try {
      const p = JSON.parse(result)
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : null
    } catch {
      return null
    }
  }, [result])

  const status = typeof parsed?.status === 'string' ? (parsed.status as string) : undefined

  const rows = useMemo(() => {
    const applied = Array.isArray(parsed?.applied) ? (parsed.applied as ConfigAppliedChange[]) : null
    if (applied?.length) {
      return applied.map((a) => {
        const type = a.type ?? 'string'
        const diff = 'oldValue' in a ? diffConfigFieldValue(type, a.oldValue, a.newValue) : null
        return {
          key: String(a.key ?? ''),
          label: a.label ?? String(a.key ?? ''),
          diff,
          from: diff || !('oldValue' in a) ? null : formatConfigFieldValue(type, a.oldValue, emptyLabel),
          to: diff ? null : formatConfigFieldValue(type, a.newValue, emptyLabel),
        }
      })
    }
    const changes = Array.isArray(params.changes) ? (params.changes as Array<{ key?: string; value?: unknown }>) : null
    if (changes) {
      return changes.map((c) => ({
        key: String(c.key ?? ''),
        label: String(c.key ?? ''),
        diff: null,
        from: null,
        to: formatConfigFieldValue('string', c.value, emptyLabel),
      }))
    }
    return []
  }, [parsed, params, emptyLabel])

  const resourceReq = params.resource && typeof params.resource === 'object' ? (params.resource as { operation?: string }) : undefined
  const resourceOp = typeof parsed?.operation === 'string' ? (parsed.operation as string) : resourceReq?.operation
  const resourceTitle = typeof parsed?.title === 'string' ? (parsed.title as string) : undefined

  const failed = isError || status === 'error'
  const rejected = isDenied || status === 'rejected' || status === 'cancelled'
  const tone = toolRowTone(rejected, failed)

  const interrupted = rejected || failed
  const headerLabel = toolOutcomeLabel({
    streaming: isStreaming,
    interrupted,
    streamingLabel: t('chat.toolBlock.applyingSettings'),
    actionLabel: resourceOp === 'delete'
      ? t('chat.toolBlock.deleteSettings')
      : resourceOp === 'create'
        ? t('chat.toolBlock.createSettings')
        : t('chat.toolBlock.updateSettings'),
    doneLabel: resourceOp === 'delete'
      ? t('chat.toolBlock.configDeleted')
      : resourceOp === 'create'
        ? t('chat.toolBlock.configCreated')
        : resourceOp === 'update'
          ? t('chat.toolBlock.configUpdated')
          : t('chat.toolBlock.appliedSettings'),
  })

  const summary = resourceTitle ?? (rows.length > 0 ? t('chat.toolBlock.settingsChangeCount', { count: rows.length }) : '')
  const errorMsg = failed && typeof parsed?.message === 'string' ? (parsed.message as string) : ''
  const expandable = rows.length > 0 || !!errorMsg

  return (
    <ExpandableToolRow
      icon={<SlidersHorizontal className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(headerLabel, isStreaming)}
      summary={summary || undefined}
      streaming={isStreaming}
      tone={tone}
      expandable={allowExpand && expandable}
    >
      <div className="space-y-1.5">
        {errorMsg ? <ToolErrorText className="mb-1">{errorMsg}</ToolErrorText> : null}
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline gap-2">
            <span className="w-32 shrink-0 truncate text-muted-foreground" title={r.label}>{r.label}</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5">
              {r.diff ? (
                <span className="break-all font-medium text-foreground">{r.diff}</span>
              ) : (
                <>
                  {r.from !== null && (
                    <>
                      <span className="text-muted-foreground/60 line-through">{r.from}</span>
                      <span className="text-muted-foreground/50">→</span>
                    </>
                  )}
                  <span className="break-all font-medium text-foreground">{r.to}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </ExpandableToolRow>
  )
}

/** Dev-only: comma-separated tool names to show raw debug UI. e.g. RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []
