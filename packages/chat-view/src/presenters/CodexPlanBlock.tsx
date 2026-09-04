import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Check, ClipboardList, Copy, Expand } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import type {
  CodexPlanApprovalState,
  CodexPlanItem,
} from '@superone/shared/agent-types'
import { ToolRow } from './ToolRow'

export interface CodexPlanMarkdownProps {
  text: string
  isStreaming: boolean
}

export interface CodexPlanApprovalActions {
  onApprove: () => void
  onReject: (feedback?: string) => void
}

export interface CodexPlanBlockPresenterProps {
  item: CodexPlanItem
  isStreaming: boolean
  hasFollowingItem?: boolean
  planApproval?: CodexPlanApprovalState
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  onOpenFullscreen?: (text: string, actions: {
    onApprove?: () => void
    onReject?: (feedback?: string) => void
    planApproval?: CodexPlanApprovalState
  }) => void
  onCopy?: (text: string) => void | Promise<void>
  renderApprovalActions?: (actions: CodexPlanApprovalActions) => ReactNode
  Markdown: ComponentType<CodexPlanMarkdownProps>
}

function PlanApprovalBadge({ planApproval }: { planApproval: CodexPlanApprovalState }) {
  const { t } = useTranslation()
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
      planApproval.status === 'approved'
        ? 'bg-success/10 text-success'
        : 'bg-error/10 text-error',
    )}>
      {planApproval.status === 'approved' ? t('chat.plan.approved') : t('chat.plan.rejected')}
    </span>
  )
}

/** Shared Codex plan card. Hosts only provide markdown and host-only actions. */
export function CodexPlanBlockPresenter({
  item,
  isStreaming,
  hasFollowingItem = false,
  planApproval,
  onApprovePlan,
  onRejectPlan,
  onOpenFullscreen,
  onCopy,
  renderApprovalActions,
  Markdown,
}: CodexPlanBlockPresenterProps) {
  const { t } = useTranslation()
  const isItemStreaming = isStreaming && !hasFollowingItem
  const [expanded, setExpanded] = useState(isItemStreaming)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isItemStreaming) setExpanded(true)
  }, [isItemStreaming])

  const copy = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (onCopy) await onCopy(item.text)
    else await navigator.clipboard?.writeText(item.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }

  const approve = (): void => {
    setExpanded(false)
    onApprovePlan?.()
  }
  const reject = (feedback?: string): void => {
    setExpanded(false)
    onRejectPlan?.(feedback)
  }
  const actions = { onApprove: approve, onReject: reject }

  return (
    <ToolRow
      icon={<ClipboardList className="size-3.5 shrink-0 text-primary" />}
      expandable
      mountDetails="expanded"
      expanded={expanded}
      onExpandedChange={setExpanded}
      className="mb-0.5 mt-1 border border-border/60 bg-muted/30 hover:bg-muted/50"
      detailsClassName="border-t border-border/50"
      details={(
        <>
          <div className="max-h-96 overflow-y-auto px-4 py-3 text-xs">
            <Markdown text={item.text} isStreaming={isItemStreaming} />
          </div>
          {!planApproval && onApprovePlan && onRejectPlan && renderApprovalActions ? (
            <div className="flex items-center justify-end border-t border-border/50 px-3 py-2">
              {renderApprovalActions(actions)}
            </div>
          ) : null}
        </>
      )}
      headerClassName="py-2"
      trailing={expanded ? (
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t('tooltips.copyPlan')}
            title={t('tooltips.copyPlan')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={copy}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
          {onOpenFullscreen ? (
            <button
              type="button"
              aria-label={t('tooltips.fullscreen')}
              title={t('tooltips.fullscreen')}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onOpenFullscreen(item.text, { onApprove: onApprovePlan, onReject: onRejectPlan, planApproval })
              }}
            >
              <Expand className="size-3" />
            </button>
          ) : null}
        </div>
      ) : undefined}
    >
      <span className="shrink-0 whitespace-nowrap font-medium text-foreground">{t('chat.plan.label')}</span>
      {planApproval ? <PlanApprovalBadge planApproval={planApproval} /> : null}
      {!expanded ? <span className="min-w-0 truncate text-muted-foreground">{item.text.split('\n')[0]}</span> : null}
      {!expanded && planApproval?.status === 'rejected' && planApproval.feedback ? (
        <span className="min-w-0 truncate text-error/75">{planApproval.feedback}</span>
      ) : null}
    </ToolRow>
  )
}
