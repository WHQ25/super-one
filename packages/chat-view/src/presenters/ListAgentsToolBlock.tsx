import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  agentGroupCounts,
  parseListAgents,
  type AgentGroup,
  type AgentGroupCount,
  type ListedAgent,
  type ListedAgentStatus,
} from './list-agents-display'
import {
  CompactLabeledToolRow,
  ToolName,
  ToolRow,
  ToolSummary,
  toolOutcomeLabel,
  withStreamingEllipsis,
} from './ToolRow'

export interface ListAgentsToolBlockPresenterProps {
  /** Raw tool output, `[denied] ` already stripped by `ToolBlock`. */
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  /** When false, header-only (subagent card). Default true. */
  allowExpand?: boolean
}

const STATUS_DOT: Record<ListedAgentStatus, string> = {
  running: 'bg-success',
  waiting: 'bg-warning',
  // Reachable but quiet reads as an outline; unreachable is filled-but-faint, so the
  // two never look like the same row at a glance.
  idle: 'border border-muted-foreground/60',
  offline: 'bg-muted-foreground/25',
  unknown: 'bg-muted-foreground/40',
}

function StatusDot({ status }: { status: ListedAgentStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])}
      title={t(`chat.toolBlock.listAgents.status.${status}`)}
    />
  )
}

function AgentRow({ agent }: { agent: ListedAgent }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-muted/40">
      <StatusDot status={agent.status} />
      {/* The name is what `SendMessage({ to })` takes, so it stays copyable-looking
          and never truncates before the metadata does. */}
      <span className="max-w-[45%] truncate font-mono text-foreground" title={agent.name}>
        {agent.name}
      </span>
      {agent.ref ? (
        <span className="shrink-0 rounded bg-muted/60 px-1 font-mono text-2xs text-muted-foreground">
          {agent.ref}
        </span>
      ) : null}
      {agent.descriptors.length > 0 ? (
        <span className="min-w-0 truncate text-muted-foreground" title={agent.descriptors.join(' · ')}>
          {agent.descriptors.join(' · ')}
        </span>
      ) : null}
      {agent.age ? (
        <span className="ml-auto shrink-0 pl-1.5 text-2xs text-muted-foreground/70">{agent.age}</span>
      ) : null}
    </div>
  )
}

function GroupSection({ group }: { group: AgentGroup }) {
  const { t } = useTranslation()
  const key = group.kind === 'unknown' ? null : group.kind
  // The harness owns these headings; an unrecognized one is printed as it came rather
  // than dropped, so a new agent kind still shows up under its real name.
  const title = key ? t(`chat.toolBlock.listAgents.group.${key}`) : group.title
  const count = group.declaredCount ?? group.agents.length
  const truncated = group.declaredCount != null && group.declaredCount > group.agents.length

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1 text-2xs uppercase tracking-wide text-muted-foreground/60">
        <span>{title}</span>
        <span className="tabular-nums">{count}</span>
      </div>
      {group.agents.map((agent, index) => (
        <AgentRow key={`${agent.name}:${agent.ref ?? ''}:${index}`} agent={agent} />
      ))}
      {truncated ? (
        <span className="px-1.5 py-0.5 text-2xs text-muted-foreground/60">
          {t('chat.toolBlock.listAgents.truncated', {
            count: group.declaredCount! - group.agents.length,
          })}
        </span>
      ) : null}
    </div>
  )
}

function useGroupSummary(counts: AgentGroupCount[]): string {
  const { t } = useTranslation()
  return counts
    .map((group) =>
      group.kind === 'unknown'
        ? t('chat.toolBlock.listAgents.count.agents', { count: group.count })
        : t(`chat.toolBlock.listAgents.count.${group.kind}`, { count: group.count }),
    )
    .join(' · ')
}

/**
 * Who the agent can talk to right now.
 *
 * `ListAgents` is a discovery call: the human story is "how many agents are reachable,
 * and of what kind" — which fits the collapsed row — while the addresses, statuses and
 * ages that only matter when reading the transcript closely live behind expand.
 */
export function ListAgentsToolBlockPresenter({
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: ListAgentsToolBlockPresenterProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parseListAgents(result), [result])
  const counts = useMemo(() => agentGroupCounts(info), [info])
  const groupSummary = useGroupSummary(counts)

  const tone = isDenied ? 'denied' : isError ? 'error' : 'default'
  const interrupted = isDenied || !!isError
  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted,
      streamingLabel: t('chat.toolBlock.listAgents.listing'),
      actionLabel: t('chat.toolBlock.listAgents.listAgents'),
      doneLabel: t('chat.toolBlock.listAgents.agentsListed'),
    }),
    isStreaming,
  )
  const icon = <Users className="size-3 shrink-0 text-muted-foreground" />

  // With no section to count, whatever the tool said *is* the answer — an empty-roster
  // sentence, a warning, an unrecognized format. It goes in the header rather than
  // behind a chevron, and it is never restated as "no agents": the two are different
  // claims, and only the tool knows which one it made.
  const structured = info.groups.length > 0
  const notes = info.notes.length > 0 ? info.notes : info.raw ? info.raw.split('\n') : []
  const headline = structured ? groupSummary : (notes[0] ?? '')
  const extraText = structured ? notes.join(' · ') : notes.slice(1).join('\n')

  const summary = isStreaming
    ? undefined
    : headline || (interrupted ? undefined : t('chat.toolBlock.listAgents.none'))

  if (!allowExpand) {
    return (
      <CompactLabeledToolRow
        icon={icon}
        label={label}
        summary={summary}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  const hasBody = !isStreaming && (structured || !!extraText)

  return (
    <ToolRow
      icon={icon}
      tone={tone}
      expandable={hasBody}
      detailsClassName="border-t border-border/40 px-1 py-1 text-xs"
      details={hasBody ? (
        <div className="flex flex-col gap-0.5">
          {info.groups.map((group, index) => (
            <GroupSection key={`${group.title}:${index}`} group={group} />
          ))}
          {extraText ? (
            structured ? (
              // Truncation and reachability warnings ride alongside a parsed roster.
              <span className="px-1.5 py-1 text-2xs text-muted-foreground/70">{extraText}</span>
            ) : (
              <pre className="whitespace-pre-wrap break-words px-1.5 py-1 font-mono text-2xs text-muted-foreground">
                {extraText}
              </pre>
            )
          ) : null}
        </div>
      ) : undefined}
    >
      <ToolName streaming={isStreaming && !isDenied} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
      {/* Eats the slack so the chevron stays pinned to the right edge. */}
      <span className="flex-1" />
    </ToolRow>
  )
}
