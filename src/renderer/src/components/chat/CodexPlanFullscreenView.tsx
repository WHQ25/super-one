import { useEffect, useState } from 'react'
import { Check, ClipboardList, Copy, X } from 'lucide-react'
import { MarkdownView } from '@/components/MarkdownPreview'
import { CodexPlanImplementFooter } from './CodexPlanImplementFooter'
import type { CodexPlanApprovalState } from '../../../../shared/agent-types'
import { cn } from '@/lib/utils'

interface CodexPlanFullscreenViewProps {
  text: string
  onClose: (reason?: 'dismiss' | 'approve' | 'reject') => void
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}

export function CodexPlanFullscreenView({
  text,
  onClose,
  onApprovePlan,
  onRejectPlan,
  planApproval,
}: CodexPlanFullscreenViewProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (onApprovePlan && onRejectPlan) {
          return
        }
        e.preventDefault()
        onClose('dismiss')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onApprovePlan, onRejectPlan, onClose])

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleApprove = () => {
    onApprovePlan?.()
    onClose('approve')
  }

  const handleReject = (feedback?: string) => {
    onRejectPlan?.(feedback)
    onClose('reject')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Plan</span>
        {planApproval && (
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
              planApproval.status === 'approved'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400',
            )}
          >
            {planApproval.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={handleCopy} className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Copy plan">
            {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
          </button>
          <button onClick={() => onClose('dismiss')} className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <MarkdownView content={text} className="px-6 py-4 text-sm" />
      </div>
      {planApproval && (
        <div className="border-t border-border px-4 py-2 text-xs">
          {planApproval.status === 'approved' ? (
            <div className="flex items-center gap-1.5 text-green-400">
              <Check className="size-3 shrink-0" />
              <span className="font-medium">Plan Approved</span>
            </div>
          ) : (
            <div className="space-y-1 text-red-400">
              <div className="flex items-center gap-1.5">
                <X className="size-3 shrink-0" />
                <span className="font-medium">Plan Rejected</span>
              </div>
              {planApproval.feedback && (
                <div className="text-red-400/75">{planApproval.feedback}</div>
              )}
            </div>
          )}
        </div>
      )}
      {onApprovePlan && onRejectPlan && (
        <div className="flex shrink-0 items-center justify-end border-t border-border px-4 py-3">
          <CodexPlanImplementFooter onApprove={handleApprove} onReject={handleReject} />
        </div>
      )}
    </div>
  )
}
