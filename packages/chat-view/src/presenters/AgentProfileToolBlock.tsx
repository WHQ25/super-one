/**
 * Chat tool UI for SuperOne agent profile MCP tools:
 * agent_profile_list / agent_profile_apply / agent_profile_delete
 *
 * Same grammar as the automation rows: streaming sentence case, done Title
 * Case, denied/error keep the action label and let the badge speak.
 */

import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { decode as toonDecode } from '@toon-format/toon'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import {
  AGENT_PROFILE_OPTION_KEYS,
  optionDisplayValue,
  type AgentProfileOptionKey,
  type AgentProfileOptions,
} from '@superone/shared/agent-profile-options'
import { ExpandableToolRow } from './ToolRow'

export type AgentProfileToolName = 'agent_profile_list' | 'agent_profile_apply' | 'agent_profile_delete'

export interface AgentProfileToolBlockPresenterProps {
  toolName: AgentProfileToolName
  params: Record<string, unknown>
  result?: string | null
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

function AgentProfileIcon() {
  return <Bot className="size-3 shrink-0 text-muted-foreground" />
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** JSON first, then TOON (the list table); null when neither parses. */
function parseResult(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      return asRecord(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  try {
    return asRecord(toonDecode(text))
  } catch {
    return null
  }
}

function tone(isDenied: boolean, isError: boolean, status: string): 'default' | 'error' | 'denied' {
  if (isDenied || status === 'rejected' || status === 'cancelled') return 'denied'
  if (isError || status === 'error') return 'error'
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

export function AgentProfileToolBlockPresenter({
  toolName,
  params,
  result,
  isStreaming = false,
  isError = false,
  isDenied = false,
  allowExpand = true,
}: AgentProfileToolBlockPresenterProps) {
  const { t } = useTranslation()
  const k = 'chat.toolBlock.agentProfile'
  const rec = parseResult(result)
  const status = str(rec?.status)
  const rowTone = tone(isDenied, isError, status)
  const interrupted = rowTone !== 'default'
  const errorMessage = rowTone === 'error' ? str(rec?.message) || undefined : undefined

  if (toolName === 'agent_profile_list') {
    const detail = asRecord(rec?.profile)
    const rows = asArray(rec?.profiles).map((row) => asRecord(row) ?? {})
    const byId = !!str(params.id)
    const label = isStreaming
      ? t(byId ? `${k}.readingAgent` : `${k}.listingAgents`)
      : interrupted
        ? t(byId ? `${k}.readAgent` : `${k}.listAgents`)
        : t(detail ? `${k}.agentRead` : `${k}.agentsListed`)
    const summary = errorMessage
      ?? (detail ? str(detail.name) : !isStreaming && !interrupted && rec ? t(`${k}.agentCount`, { count: rows.length }) : undefined)
    return (
      <ExpandableToolRow
        icon={<AgentProfileIcon />}
        label={label}
        summary={summary || undefined}
        streaming={isStreaming}
        tone={rowTone}
        expandable={allowExpand && rowTone === 'default' && (rows.length > 0 || !!detail)}
      >
        {detail ? (
          <div className="space-y-1">
            <FieldRow label={t(`${k}.fields.harness`)} value={str(detail.harnessId)} />
            {str(detail.description) ? <FieldRow label={t(`${k}.fields.description`)} value={str(detail.description)} /> : null}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row, index) => (
              <li key={str(row.id) || index} className="rounded bg-muted/30 px-2 py-1.5">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <span className="min-w-0 truncate">{str(row.name) || '—'}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {str(row.harness)}{row.base === true ? ` · ${t(`${k}.builtIn`)}` : ''}
                  </span>
                </div>
                {str(row.description) ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{str(row.description)}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ExpandableToolRow>
    )
  }

  if (toolName === 'agent_profile_apply') {
    const isUpdate = (str(params.action) || str(rec?.action)) === 'update'
    const profile = asRecord(rec?.profile)
    const name = str(profile?.name) || str(params.name)
    const changed = asArray(rec?.changed).filter((field): field is string => typeof field === 'string')
    const label = isStreaming
      ? t(isUpdate ? `${k}.confirmingUpdate` : `${k}.confirmingCreate`)
      : interrupted
        ? t(isUpdate ? `${k}.updateAgent` : `${k}.createAgent`)
        : t(isUpdate ? `${k}.agentUpdated` : `${k}.agentCreated`)
    const runtime = asRecord(profile?.runtime)
    return (
      <ExpandableToolRow
        icon={<AgentProfileIcon />}
        label={label}
        summary={errorMessage ?? (name || undefined)}
        streaming={isStreaming}
        tone={rowTone}
        expandable={allowExpand && rowTone === 'default' && !!profile}
      >
        {profile ? (
          <div className="space-y-1">
            <FieldRow label={t(`${k}.fields.harness`)} value={str(profile.harnessId)} />
            {str(profile.description) ? <FieldRow label={t(`${k}.fields.description`)} value={str(profile.description)} /> : null}
            {str(runtime?.model) ? <FieldRow label={t(`${k}.fields.model`)} value={str(runtime?.model)} /> : null}
            {str(runtime?.effort) ? <FieldRow label={t(`${k}.fields.effort`)} value={formatEffortLabel(str(runtime?.effort))} /> : null}
            {Object.entries(asRecord(runtime?.options) ?? {}).map(([key, value]) => {
              if (!(AGENT_PROFILE_OPTION_KEYS as string[]).includes(key)) return null
              const text = optionDisplayValue(key as AgentProfileOptionKey, value as AgentProfileOptions[AgentProfileOptionKey])
              return (
                <FieldRow
                  key={key}
                  label={t(`chat.permission.agentProfile.fields.${key}`)}
                  value={text === 'on' || text === 'off' ? t(`chat.permission.agentProfile.${text}`) : text}
                />
              )
            })}
            {changed.length ? <FieldRow label={t(`${k}.fields.changed`)} value={changed.join(', ')} /> : null}
          </div>
        ) : null}
      </ExpandableToolRow>
    )
  }

  const deleted = asArray(rec?.deleted).map((row) => asRecord(row) ?? {})
  const failed = asArray(rec?.failed).map((row) => asRecord(row) ?? {})
  const requested = asArray(params.ids).length
  let label = t(`${k}.agentsDeleted`)
  let summary: string | undefined = errorMessage
  if (isStreaming) {
    label = t(`${k}.confirmingDelete`)
    summary = requested ? t(`${k}.agentCount`, { count: requested }) : undefined
  } else if (interrupted) {
    label = t(`${k}.deleteAgents`)
  } else if (status === 'not_found') {
    label = t(`${k}.nothingDeleted`)
    summary = str(rec?.message) || undefined
  } else if (status === 'partial') {
    label = t(`${k}.partiallyDeleted`)
    summary = t(`${k}.partialDeleteSummary`, { deleted: deleted.length, failed: failed.length })
  } else if (rec) {
    summary = deleted.map((row) => str(row.name)).filter(Boolean).join(', ') || undefined
  }
  return (
    <ExpandableToolRow
      icon={<AgentProfileIcon />}
      label={label}
      summary={summary}
      streaming={isStreaming}
      tone={rowTone}
      expandable={allowExpand && failed.length > 0}
    >
      <ul className="space-y-0.5">
        {failed.map((row, index) => (
          <li key={str(row.id) || index} className="text-warning">
            {str(row.name) || str(row.id)}{str(row.error) ? ` — ${str(row.error)}` : ''}
          </li>
        ))}
      </ul>
    </ExpandableToolRow>
  )
}

export function isAgentProfileToolName(name: string): name is AgentProfileToolName {
  return name === 'agent_profile_list' || name === 'agent_profile_apply' || name === 'agent_profile_delete'
}
