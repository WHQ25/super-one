import { ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RealtimeDelegationStatus } from '@superone/chat-view/presenters/RealtimeDelegationStatus'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { usePlanFullscreen } from './plan-fullscreen-context'
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
  const { t } = useTranslation()
  const working = activity.status === 'working'
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
      <RealtimeDelegationStatus activity={activity} onOpen={onOpen} />

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
