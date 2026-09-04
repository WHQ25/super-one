import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { CodexPlanApprovalActions } from './presenters/CodexPlanBlock'

export function PortablePlanActions({ onApprove, onReject }: CodexPlanApprovalActions) {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="flex w-full flex-col gap-2">
      <input
        aria-label="Plan feedback"
        className="h-8 w-full rounded bg-muted px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Reject feedback (optional)"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded bg-success px-3 text-xs font-medium text-success-foreground"
          type="button"
          onClick={onApprove}
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded bg-destructive px-3 text-xs font-medium text-destructive-foreground"
          type="button"
          onClick={() => onReject(feedback.trim() || undefined)}
        >
          <X className="size-3.5" />
          Reject
        </button>
      </div>
    </div>
  )
}
