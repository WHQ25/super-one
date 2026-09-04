import { Check, PenLine, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface PlanApprovalOutcome {
  approved: boolean
  feedback?: string
}

export function EnterPlanModeBlock() {
  const { t } = useTranslation()
  return (
    <div className="my-4 flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-sm">
      <PenLine className="size-3 shrink-0 text-primary" />
      <span className="font-medium text-primary">{t('chat.toolBlock.enteredPlanMode')}</span>
    </div>
  )
}

export function planOutcomeFromResult(result?: string): PlanApprovalOutcome | null {
  if (!result) return null
  return result.startsWith('[denied] ')
    ? { approved: false, feedback: result.slice('[denied] '.length) }
    : { approved: true }
}

/** Shared Claude plan-mode outcome row. Desktop may supply its live-store fallback. */
export function ExitPlanModeBlockPresenter({
  result,
  liveOutcome = null,
}: {
  result?: string
  liveOutcome?: PlanApprovalOutcome | null
}) {
  const outcome = planOutcomeFromResult(result) ?? liveOutcome

  if (!outcome) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-muted/20 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }

  if (outcome.approved) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-success/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-success" />
        <span className="font-medium text-success">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-success" />
      </div>
    )
  }

  return (
    <div className="my-4 rounded bg-error/10 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <PenLine className="size-3 shrink-0 text-error" />
        <span className="font-medium text-error">Plan Rejected</span>
        <X className="ml-auto size-3 shrink-0 text-error" />
      </div>
      {outcome.feedback && outcome.feedback !== 'User rejected the plan' ? (
        <div className="mt-1 text-xs text-error/70">{outcome.feedback}</div>
      ) : null}
    </div>
  )
}
