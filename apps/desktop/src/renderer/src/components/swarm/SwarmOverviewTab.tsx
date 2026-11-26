import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { BeeIcon } from '@superone/chat-view/presenters/SubagentBlock'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import { computeSwarmProgress, getMemberPalette, isTaskDoneForMember } from './swarm-board-utils'

interface SwarmOverviewTabProps {
  snapshot: SwarmBoardSnapshot
  memberColorMap?: Record<string, number>
}

export function SwarmOverviewTab({
  snapshot,
  memberColorMap = {},
}: SwarmOverviewTabProps) {
  const { t } = useTranslation()
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})
  const [selectedMember, setSelectedMember] = useState<string | null>(null)
  const { doneTasks, totalTasks, threads } = computeSwarmProgress(snapshot)
  const membersByName = new Map(snapshot.members.map((m) => [m.name, m]))
  const coordinator = snapshot.members.find((m) => m.role === 'coordinator')
  const workers = snapshot.members.filter((m) => m.role !== 'coordinator')
  const coordinatorLastPost = coordinator?.lastPostText?.split(/\r?\n/, 1)[0]

  const visibleThreads = selectedMember
    ? threads.filter((thread) => thread.tasks.includes(selectedMember))
    : threads

  const toggleThread = (id: string) => {
    setExpandedThreads((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-5 p-4">
      {(snapshot.plan?.goal?.title || snapshot.plan?.goal?.line) && (
        <section className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('swarmBoard.overview.goal')}
          </div>
          {snapshot.plan?.goal?.title && (
            <h2 className="mt-1 text-base font-semibold text-foreground">
              {snapshot.plan.goal.title}
            </h2>
          )}
          {snapshot.plan?.goal?.line && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {snapshot.plan.goal.line}
            </p>
          )}
        </section>
      )}

      {totalTasks > 0 && (
        <section className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-2.5">
          <CheckCircle2
            className={cn(
              'size-4 shrink-0',
              doneTasks >= totalTasks ? 'text-emerald-500' : 'text-muted-foreground',
            )}
          />
          <span className="text-xs font-medium text-foreground">
            {t('swarmBoard.overview.tasksDone', { done: doneTasks, total: totalTasks })}
          </span>
          <div className="ml-auto h-1.5 w-28 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((doneTasks / totalTasks) * 100)}%` }}
            />
          </div>
        </section>
      )}

      {visibleThreads.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('swarmBoard.overview.threads')}
          </h3>
          <div className="space-y-2">
            {visibleThreads.map((thread) => {
              const isExpanded = Boolean(expandedThreads[thread.id]) || Boolean(selectedMember)
              const threadTasks = selectedMember
                ? thread.tasks.filter((name) => name === selectedMember)
                : thread.tasks
              const pct = thread.totalCount > 0 ? Math.round((thread.doneCount / thread.totalCount) * 100) : 0
              return (
                <div
                  key={thread.id}
                  className="rounded-xl border border-border/70 bg-card/40 transition-colors hover:border-border"
                >
                  <button
                    type="button"
                    onClick={() => toggleThread(thread.id)}
                    className="flex w-full items-start gap-3 p-3.5 text-left"
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        thread.isDone ? 'bg-emerald-500' : 'bg-amber-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {thread.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {thread.isDone ? t('swarmBoard.overview.done') : t('swarmBoard.overview.inProgress')}
                        </span>
                      </div>
                      {thread.goal && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {thread.goal}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-center">
                      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {thread.doneCount}/{thread.totalCount}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="space-y-1.5 border-t border-border/50 px-4 py-2.5">
                      {threadTasks.map((taskName) => {
                        const done = isTaskDoneForMember(taskName, snapshot.messages, membersByName)
                        const member = membersByName.get(taskName)
                        const palette = getMemberPalette(taskName, memberColorMap[taskName.toLowerCase()])
                        const taskDesc = snapshot.plan?.tasks?.[taskName]
                        return (
                          <div key={taskName} className="flex items-center gap-2 text-xs">
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                done ? 'bg-emerald-500' : member?.isWorking ? 'bg-amber-500' : 'bg-muted-foreground/40',
                              )}
                            />
                            <span className={cn('font-medium', palette.text)}>@{taskName}</span>
                            {taskDesc && (
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                {taskDesc}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('swarmBoard.overview.theTeam')}
        </h3>
        {coordinator && (
          <div className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card/40 p-3 text-left">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/15 text-amber-500">
              <BeeIcon color="#f59e0b" crowned className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {t('swarmBoard.overview.coordinator')}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {coordinatorLastPost || coordinator.model || '@coordinator'}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSelectedMember(null)}
            className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-muted/60"
          >
            <div
              className={cn(
                'relative flex size-10 items-center justify-center rounded-lg border bg-muted/40',
                selectedMember === null ? 'border-foreground ring-1 ring-foreground' : 'border-border',
              )}
            >
              <BeeIcon color="#a855f7" className="absolute left-1 top-1 size-3" />
              <BeeIcon color="#3b82f6" className="absolute right-1 top-1.5 size-3" />
              <BeeIcon color="#f59e0b" className="absolute bottom-1 left-1/2 size-3 -translate-x-1/2" />
            </div>
            <span
              className={cn(
                'max-w-14 truncate text-[11px]',
                selectedMember === null ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {t('swarmBoard.overview.all')}
            </span>
          </button>

          {workers.map((member) => {
            const palette = getMemberPalette(member.name, memberColorMap[member.name.toLowerCase()])
            const isSelected = selectedMember === member.name
            return (
              <button
                key={member.name}
                type="button"
                onClick={() => setSelectedMember(isSelected ? null : member.name)}
                className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-muted/60"
                title={member.taskDescription || `@${member.name}`}
              >
                <div
                  className={cn(
                    'relative flex size-10 items-center justify-center rounded-lg border',
                    palette.bg,
                    palette.text,
                    isSelected ? 'border-foreground ring-1 ring-foreground' : palette.border,
                  )}
                >
                  <BeeIcon color={palette.hex} className="size-5" />
                  {member.isWorking && (
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
                  )}
                </div>
                <span
                  className={cn(
                    'max-w-14 truncate text-[11px]',
                    isSelected ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  @{member.name}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
