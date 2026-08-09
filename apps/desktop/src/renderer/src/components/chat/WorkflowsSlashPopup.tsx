import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Workflow, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useSessionScope, getActiveSessionView } from '@/stores/chat'
import { collectSessionWorkflows } from './collect-session-workflows'
import { WorkflowBlock } from './WorkflowBlock'
import { computeBackgroundActivitySignature } from './ChatStatusBar'

export function WorkflowsSlashPopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const activitySignature = useActiveSession((s) => computeBackgroundActivitySignature(s.messages))
  const sessionStatus = useActiveSession((s) => s.status)
  const taskProgress = useActiveSession((s) => s.taskProgress)

  const items = useMemo(() => {
    const messages = getActiveSessionView(scope).messages
    return collectSessionWorkflows(messages)
    // Recompute when transcript structure / task completion changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activitySignature, taskProgress, sessionStatus, scope])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="flex max-h-96 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {t('chat.workflowsPopup.title', 'Workflows')}
          </span>
          {items.length > 0 && (
            <span className="truncate text-xs text-muted-foreground">
              {t('chat.workflowsPopup.totalBadge', {
                defaultValue: '{{count}} in this session',
                count: items.length,
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onClose()}
          title={t('common.close', 'Close')}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="activity-panel min-h-0 flex-1 divide-y divide-border overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Workflow className={cn('size-5 text-muted-foreground/50')} />
            <p className="text-xs text-muted-foreground">
              {t('chat.workflowsPopup.empty', 'No workflows in this session yet')}
            </p>
          </div>
        ) : (
          items.map((item, i) => (
            <div key={item.id}>
              <WorkflowBlock
                toolBlock={item.toolBlock}
                resultBlock={item.resultBlock}
                isStreaming={sessionStatus === 'streaming'}
                defaultExpanded={i === 0}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
