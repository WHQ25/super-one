import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { BeeIcon } from '@superone/chat-view/presenters/SubagentBlock'
import type { SwarmBoardMember, SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import { getMemberPalette } from './swarm-board-utils'

interface SwarmMembersTabProps {
  snapshot: SwarmBoardSnapshot
  memberColorMap?: Record<string, number>
  memberToolUseIdMap?: Record<string, string>
  onOpenMemberSubagent?: (toolUseId: string) => void
}

function MemberRow({
  member,
  colorIndex,
  clickable,
  onClick,
}: {
  member: SwarmBoardMember
  colorIndex?: number
  clickable: boolean
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const palette = getMemberPalette(member.name, colorIndex)
  const isCoordinator = member.role === 'coordinator'
  const lastPostLine = member.lastPostText?.split(/\r?\n/, 1)[0]?.trim()

  const content = (
    <>
      <div
        className={cn(
          'relative flex size-9 shrink-0 items-center justify-center rounded-lg border',
          palette.bg,
          palette.border,
          palette.text,
        )}
      >
        <BeeIcon color={palette.hex} crowned={isCoordinator} className="size-5" />
        {member.isWorking && (
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">@{member.name}</span>
          {isCoordinator ? (
            <span className="text-[11px] text-muted-foreground">
              {t('swarmBoard.members.coordinator')}
            </span>
          ) : member.isWorking ? (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {t('swarmBoard.members.working')}
            </span>
          ) : null}
          {member.taskDescription && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {member.taskDescription}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {member.model && <span className="hidden sm:inline">{member.model}</span>}
            {member.lastPostSeq !== undefined && <span>#{member.lastPostSeq}</span>}
          </div>
        </div>

        {(member.currentAction || lastPostLine) && (
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {member.isWorking && member.currentAction ? member.currentAction : lastPostLine}
          </div>
        )}
      </div>
    </>
  )

  if (!clickable) {
    return (
      <div className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3 text-left">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3 text-left transition-colors hover:border-border hover:bg-card/70"
    >
      {content}
    </button>
  )
}

export function SwarmMembersTab({
  snapshot,
  memberColorMap = {},
  memberToolUseIdMap = {},
  onOpenMemberSubagent,
}: SwarmMembersTabProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return snapshot.members
    return snapshot.members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.taskDescription?.toLowerCase().includes(q) ?? false) ||
        (m.model?.toLowerCase().includes(q) ?? false),
    )
  }, [snapshot.members, query])

  const coordinator = filtered.find((m) => m.role === 'coordinator')
  const active = filtered.filter((m) => m.role !== 'coordinator' && m.isWorking && !m.killed)
  const standingBy = filtered.filter((m) => m.role !== 'coordinator' && !m.isWorking && !m.killed)
  const killed = filtered.filter((m) => m.role !== 'coordinator' && m.killed)

  const renderWorkerRow = (m: SwarmBoardMember) => {
    const toolUseId = memberToolUseIdMap[m.name.toLowerCase()]
    const canOpen = Boolean(toolUseId && onOpenMemberSubagent)
    return (
      <MemberRow
        key={m.name}
        member={m}
        colorIndex={memberColorMap[m.name.toLowerCase()]}
        clickable={canOpen}
        onClick={() => {
          if (toolUseId && onOpenMemberSubagent) {
            onOpenMemberSubagent(toolUseId)
          }
        }}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('swarmBoard.members.searchPlaceholder')}
            className="h-8 w-full rounded-lg border border-border/70 bg-muted/30 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {coordinator && (
          <MemberRow member={coordinator} clickable={false} />
        )}

        {active.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('swarmBoard.members.active')} {active.length}
            </div>
            <div className="space-y-2">{active.map(renderWorkerRow)}</div>
          </section>
        )}

        {standingBy.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('swarmBoard.members.standingBy')} {standingBy.length}
            </div>
            <div className="space-y-2">{standingBy.map(renderWorkerRow)}</div>
          </section>
        )}

        {killed.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('swarmBoard.members.killed')} {killed.length}
            </div>
            <div className="space-y-2 opacity-60">{killed.map(renderWorkerRow)}</div>
          </section>
        )}
      </div>
    </div>
  )
}
