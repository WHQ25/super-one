import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, CircleStop, Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  parseManageSubagents,
  type ListedSubagent,
  type ListedSubagentState,
  type ManageSubagentsAction,
  type ManageSubagentsInfo,
} from './manage-subagents-display'
import {
  CompactLabeledToolRow,
  ToolErrorText,
  ToolName,
  ToolRow,
  ToolSummary,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

export interface ManageSubagentsToolBlockPresenterProps {
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

const STATE_DOT: Record<ListedSubagentState, string> = {
  running: 'bg-success',
  waiting: 'bg-warning',
  idle: 'border border-muted-foreground/60',
  canceling: 'bg-muted-foreground/35',
  errored: 'bg-warning',
  unknown: 'bg-muted-foreground/40',
}

function ActionIcon({ action }: { action: ManageSubagentsAction }) {
  if (action === 'kill' || action === 'kill_all') {
    return <CircleStop className="size-3 shrink-0 text-muted-foreground" />
  }
  if (action === 'list' || action === 'list_peers') {
    return <Users className="size-3 shrink-0 text-muted-foreground" />
  }
  return <Bot className="size-3 shrink-0 text-muted-foreground" />
}

function SubagentStateDot({ state, label }: { state: ListedSubagentState; label: string }) {
  return (
    <span
      className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[state])}
      title={label}
    />
  )
}

function ListedSubagentRow({ subagent }: { subagent: ListedSubagent }) {
  const { t } = useTranslation()
  const stateLabel = t(`chat.toolBlock.manageSubagents.state.${subagent.state}`)
  const showTypeBadge =
    Boolean(subagent.type) &&
    subagent.type!.toLowerCase() !== subagent.role.toLowerCase()
  const secondaryText =
    subagent.stateDetail ??
    (subagent.state === 'waiting' || subagent.state === 'canceling' || subagent.state === 'errored'
      ? stateLabel
      : undefined)

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-muted/40">
      <SubagentStateDot state={subagent.state} label={stateLabel} />
      <span className="max-w-[42%] shrink-0 truncate font-medium text-foreground" title={subagent.role}>
        {subagent.role}
      </span>
      {showTypeBadge ? (
        <span className="shrink-0 rounded bg-muted/60 px-1 font-mono text-2xs text-muted-foreground">
          {subagent.type}
        </span>
      ) : null}
      {secondaryText ? (
        <span className="min-w-0 truncate text-muted-foreground" title={secondaryText}>
          {secondaryText}
        </span>
      ) : null}
      {subagent.shortId ? (
        <span
          className="ml-auto shrink-0 pl-1.5 font-mono text-2xs text-muted-foreground/70"
          title={subagent.conversationId}
        >
          {subagent.shortId}
        </span>
      ) : null}
    </div>
  )
}

function useActionLabels(action: ManageSubagentsAction): {
  streamingLabel: string
  actionLabel: string
  doneLabel: string
} {
  const { t } = useTranslation()
  if (action === 'list') {
    return {
      streamingLabel: t('chat.toolBlock.manageSubagents.listing'),
      actionLabel: t('chat.toolBlock.manageSubagents.listSubagents'),
      doneLabel: t('chat.toolBlock.manageSubagents.subagentsListed'),
    }
  }
  if (action === 'list_peers') {
    return {
      streamingLabel: t('chat.toolBlock.manageSubagents.listingPeers'),
      actionLabel: t('chat.toolBlock.manageSubagents.listPeers'),
      doneLabel: t('chat.toolBlock.manageSubagents.peersListed'),
    }
  }
  if (action === 'kill') {
    return {
      streamingLabel: t('chat.toolBlock.manageSubagents.stopping'),
      actionLabel: t('chat.toolBlock.manageSubagents.stopSubagents'),
      doneLabel: t('chat.toolBlock.manageSubagents.subagentsStopped'),
    }
  }
  if (action === 'kill_all') {
    return {
      streamingLabel: t('chat.toolBlock.manageSubagents.stoppingAll'),
      actionLabel: t('chat.toolBlock.manageSubagents.stopAllSubagents'),
      doneLabel: t('chat.toolBlock.manageSubagents.allSubagentsStopped'),
    }
  }
  return {
    streamingLabel: t('chat.toolBlock.manageSubagents.managing'),
    actionLabel: t('chat.toolBlock.manageSubagents.manageSubagents'),
    doneLabel: t('chat.toolBlock.manageSubagents.subagentsManaged'),
  }
}

function formatTargetSummary(
  info: ManageSubagentsInfo,
  t: ReturnType<typeof useTranslation>['t'],
): { node?: ReactNode; title?: string } {
  if (info.shortConversationIds.length === 1) {
    const shortId = info.shortConversationIds[0]!
    const fullId = info.conversationIds[0] ?? shortId
    return {
      title: fullId,
      node: <span className="font-mono">{shortId}</span>,
    }
  }
  if (info.shortConversationIds.length > 1) {
    const text = t('chat.toolBlock.manageSubagents.targetCount', {
      count: info.shortConversationIds.length,
    })
    return {
      title: info.conversationIds.join(', '),
      node: text,
    }
  }
  return {}
}

function buildHeaderSummary(
  info: ManageSubagentsInfo,
  isStreaming: boolean,
  interrupted: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): { node?: ReactNode; title?: string } {
  if (info.action === 'list' || info.action === 'list_peers') {
    if (isStreaming) return {}
    const activeTotal = info.declaredCount ?? info.subagents.length
    if (activeTotal > 0 || info.subagents.length > 0) {
      const count = Math.max(activeTotal, info.subagents.length)
      const text = t('chat.toolBlock.manageSubagents.activeCount', { count })
      return { node: text, title: text }
    }
    if (info.emptyList) {
      const text = t('chat.toolBlock.manageSubagents.none')
      return { node: text, title: text }
    }
    if (!interrupted && info.extraText) {
      const firstLine = info.extraText.split(/\r?\n/, 1)[0] ?? ''
      return { node: firstLine, title: firstLine }
    }
    return {}
  }

  if (info.action === 'kill' || info.action === 'kill_all') {
    if (!isStreaming && !interrupted) {
      if (info.noActiveToKill) {
        const text = t('chat.toolBlock.manageSubagents.noneToKill')
        return { node: text, title: text }
      }
      if (info.killedCount !== undefined && info.killedCount > 0) {
        const stoppedText = t('chat.toolBlock.manageSubagents.stoppedCount', {
          count: info.killedCount,
        })
        const rolesJoined = info.killedRoles.join(', ')
        const fullTitle = rolesJoined ? `${stoppedText} · ${rolesJoined}` : stoppedText
        return {
          title: fullTitle,
          node: (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">{stoppedText}</span>
              {rolesJoined ? (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="truncate">{rolesJoined}</span>
                </>
              ) : null}
            </span>
          ),
        }
      }
    }
    return formatTargetSummary(info, t)
  }

  return formatTargetSummary(info, t)
}

export function ManageSubagentsToolBlockPresenter({
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: ManageSubagentsToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parseManageSubagents(params, result, isError), [params, result, isError])
  const labels = useActionLabels(info.action)

  const tone = toolRowTone(isDenied, isError)
  const interrupted = Boolean(isDenied) || Boolean(isError)
  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted,
      ...labels,
    }),
    isStreaming,
  )
  const icon = <ActionIcon action={info.action} />
  const summary = buildHeaderSummary(info, isStreaming, interrupted, t)

  if (!allowExpand) {
    return (
      <CompactLabeledToolRow
        icon={icon}
        label={label}
        summary={summary.node}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  const deniedText = isDenied && typeof result === 'string' && result.trim() ? result.trim() : undefined
  const errorBody = deniedText ?? info.errorMessage

  let details: ReactNode = null
  if (!isStreaming) {
    if (errorBody) {
      details = <ToolErrorText className="px-1.5 py-1">{errorBody}</ToolErrorText>
    } else if ((info.action === 'list' || info.action === 'list_peers') && info.subagents.length > 0) {
      details = (
        <div className="flex flex-col gap-0.5">
          {info.subagents.map((subagent, idx) => (
            <ListedSubagentRow key={`${subagent.conversationId}:${idx}`} subagent={subagent} />
          ))}
        </div>
      )
    } else if (
      (info.action === 'kill' || info.action === 'kill_all') &&
      (info.killedRoles.length > 1 || info.conversationIds.length > 1)
    ) {
      details = (
        <div className="flex flex-col gap-1.5 px-1.5 py-1">
          {info.killedRoles.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">
                {t('chat.toolBlock.manageSubagents.stoppedRolesLabel')}
              </span>
              <div className="flex flex-wrap gap-1">
                {info.killedRoles.map((role, idx) => (
                  <span
                    key={`${role}:${idx}`}
                    className="rounded bg-muted/60 px-1.5 py-0.5 text-2xs text-foreground"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {info.conversationIds.length > 1 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-2xs text-muted-foreground">
                {t('chat.toolBlock.manageSubagents.targetsLabel')}
              </span>
              <div className="flex flex-wrap gap-1">
                {info.conversationIds.map((id, idx) => (
                  <span
                    key={`${id}:${idx}`}
                    className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                    title={id}
                  >
                    {info.shortConversationIds[idx] ?? id}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )
    } else if (info.extraText) {
      details = (
        <pre className="whitespace-pre-wrap break-words px-1.5 py-1 font-mono text-2xs text-muted-foreground">
          {info.extraText}
        </pre>
      )
    }
  }

  const hasBody = details !== null

  return (
    <ToolRow
      icon={icon}
      tone={tone}
      expandable={hasBody}
      detailsClassName="border-t border-border/40 px-1 py-1 text-xs"
      details={hasBody ? details : undefined}
    >
      <ToolName streaming={isStreaming} tone={tone}>
        {label}
      </ToolName>
      {summary.node ? <ToolSummary title={summary.title}>{summary.node}</ToolSummary> : null}
    </ToolRow>
  )
}
