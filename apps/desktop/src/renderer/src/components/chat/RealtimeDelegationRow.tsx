import { ChevronRight, List, ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { formatCompactDuration } from '@superone/chat-view/presenters/duration-format'
import { useWorkingDuration } from '@superone/chat-view/use-working-duration'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { usePlanFullscreen } from './codex-item-renderer'
import { CodexPlanImplementFooter } from './CodexPlanImplementFooter'
import type { RealtimeTurnActivity } from './realtime-turn-activities'

interface RealtimeDelegationRowProps {
  activity: RealtimeTurnActivity
  /** Jump to the backing thread at this range's first message. */
  onOpen: () => void
}

/**
 * The voice timeline's stand-in for a delegated Codex turn: the same one-line
 * status the collapsed turn used to show ("Working for 12s"), except that opening
 * it goes to the backing thread instead of unfolding in place.
 *
 * A plan the delegated turn ended on is the one decision this row answers here,
 * because the plan footer is otherwise inside the turn body the voice view no
 * longer renders.
 */
export function RealtimeDelegationRow({ activity, onOpen }: RealtimeDelegationRowProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const working = activity.status === 'working'
  const elapsed = useWorkingDuration(working ? activity.workingSince : null)
  const collaborationMode = useActiveSession((state) => state.selectedCodexCollaborationMode)
  const hasPendingInteraction = useActiveSession((state) => state.hasPendingInteraction)
  const approveCodexPlan = useChatStore((state) => state.approveCodexPlan)
  const rejectCodexPlan = useChatStore((state) => state.rejectCodexPlan)
  const planFullscreen = usePlanFullscreen()

  const plan = activity.plan
  const canRespondToPlan = plan !== null
    && plan.approval === null
    && activity.isTail
    && !working
    && collaborationMode === 'plan'
    && !hasPendingInteraction

  // Two states, same words as the collapsed turn: a live "Working for …" while the
  // range runs, "Detail" once it has settled however it settled.
  const label = working
    ? t('chat.compactMode.workingFor', { duration: formatCompactDuration(elapsed, locale) })
    : t('chat.compactMode.detail')

  const planActions = canRespondToPlan
    ? { onApprove: () => { void approveCodexPlan() }, onReject: (feedback?: string) => { void rejectCodexPlan(feedback) } }
    : null

  return (
    <div
      data-testid="realtime-delegation-row"
      data-activity-kind={activity.kind}
      data-activity-status={activity.status}
      className="@container flex min-w-0 flex-col"
    >
      {/* Same silhouette as the collapsed turn's Detail line, so the voice view reads
          like the rest of the app — only the chevron says it leads somewhere. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('chat.realtimeVoice.delegation.openThread')}
        className={cn(
          'group flex w-full items-center gap-1.5 border-b border-border/50 py-1 text-left text-xs text-muted-foreground/80',
          'transition-colors hover:text-muted-foreground',
        )}
      >
        <List className="size-3 shrink-0 opacity-70" />
        <span data-testid="realtime-delegation-status" className="min-w-0 truncate font-normal tracking-wide tabular-nums">
          {label}
        </span>
        <ChevronRight className="ml-auto size-3 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
      </button>

      {plan && planActions && (
        <div className="flex flex-col gap-2 py-2">
          <button
            type="button"
            onClick={() => planFullscreen.open(plan.text, planActions)}
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ListChecks className="size-3.5" />
            {t('chat.realtimeVoice.delegation.viewPlan')}
          </button>
          <CodexPlanImplementFooter onApprove={planActions.onApprove} onReject={planActions.onReject} />
        </div>
      )}
    </div>
  )
}
