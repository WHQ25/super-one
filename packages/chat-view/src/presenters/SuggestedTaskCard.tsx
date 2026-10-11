import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ListPlus, Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import type { SuggestedTaskState } from '@superone/shared/suggested-task'
import {
  CompactLabeledToolRow,
  ToolName,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

/** What the host can do with a pending card. Absent where launching is impossible. */
export interface SuggestedTaskActions {
  /** Resolves with an error message to show, or nothing on success. */
  launch: () => Promise<string | void>
  dismiss: () => Promise<string | void>
}

export interface SuggestedTaskCardProps {
  params: Record<string, unknown>
  /** Fallback title when the projected input has none (e.g. a phone row before its detail loads). */
  toolSummary?: string
  state?: SuggestedTaskState
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  /** False when nested inside a subagent card: one line only. */
  allowExpand?: boolean
  actions?: SuggestedTaskActions
  /** Shown instead of the buttons when `actions` is absent; defaults to "launch it on your computer". */
  unavailableReason?: string
  onOpenSession?: (sessionId: string) => void | Promise<void>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const icon = <ListPlus className="size-3 shrink-0 text-muted-foreground" />

/**
 * The `session_suggest_task` card. The result only names the card; its outcome
 * (`state`) is a host fact patched onto the row after the call.
 */
export function SuggestedTaskCard({
  params,
  toolSummary,
  state,
  isStreaming = false,
  isError = false,
  isDenied = false,
  allowExpand = true,
  actions,
  unavailableReason,
  onOpenSession,
}: SuggestedTaskCardProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'launch' | 'dismiss' | null>(null)
  const [failure, setFailure] = useState('')
  const title = str(params.title) || str(toolSummary)
  const tldr = str(params.tldr)

  if (isStreaming || isError || isDenied || !allowExpand) {
    const label = toolOutcomeLabel({
      streaming: isStreaming,
      interrupted: isDenied || isError,
      streamingLabel: t('chat.toolBlock.suggestedTask.suggestingTask'),
      actionLabel: t('chat.toolBlock.suggestedTask.suggestTask'),
      doneLabel: t('chat.toolBlock.suggestedTask.suggestedTask'),
    })
    return (
      <CompactLabeledToolRow
        icon={icon}
        label={withStreamingEllipsis(label, isStreaming)}
        streaming={isStreaming}
        tone={toolRowTone(isDenied, isError)}
        summary={title || undefined}
      />
    )
  }

  const run = async (kind: 'launch' | 'dismiss') => {
    if (!actions || busy) return
    setBusy(kind)
    setFailure('')
    try {
      const error = await actions[kind]()
      if (error) setFailure(error)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={cn('tool-node my-1 min-w-0 rounded-md border px-3 py-2', state ? 'bg-muted/20' : 'bg-card')}
      data-suggested-task-status={state?.status ?? 'pending'}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {icon}
        <ToolName>{t('chat.toolBlock.suggestedTask.suggestedTask')}</ToolName>
        {state ? <StateBadge state={state} /> : null}
      </div>
      <div className={cn('mt-1 min-w-0 break-words text-sm font-medium', state?.status === 'dismissed' && 'text-muted-foreground line-through')}>
        {title}
      </div>
      {tldr ? <p className="mt-0.5 line-clamp-3 break-words text-xs text-muted-foreground">{tldr}</p> : null}
      <Footer
        state={state}
        busy={busy}
        failure={failure}
        actions={actions}
        unavailableReason={unavailableReason}
        onRun={run}
        onOpenSession={onOpenSession}
      />
    </div>
  )
}

function StateBadge({ state }: { state: SuggestedTaskState }) {
  const { t } = useTranslation()
  const launched = state.status === 'launched'
  return (
    <span className={cn('ml-auto shrink-0 rounded px-1 py-px text-xs', launched ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
      {t(launched ? 'chat.toolBlock.suggestedTask.launched' : 'chat.toolBlock.suggestedTask.dismissed')}
    </span>
  )
}

function Footer({
  state,
  busy,
  failure,
  actions,
  unavailableReason,
  onRun,
  onOpenSession,
}: {
  state?: SuggestedTaskState
  busy: 'launch' | 'dismiss' | null
  failure: string
  actions?: SuggestedTaskActions
  unavailableReason?: string
  onRun: (kind: 'launch' | 'dismiss') => void
  onOpenSession?: (sessionId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  if (state?.status === 'launched') {
    if (!onOpenSession) return null
    return (
      <Button variant="link" size="xs" className="mt-1 h-auto px-0 has-[>svg]:px-0" onClick={() => void onOpenSession(state.sessionId)}>
        {t('chat.toolBlock.suggestedTask.openSession')}
        <ArrowUpRight />
      </Button>
    )
  }
  if (state?.status === 'dismissed') {
    if (state.by !== 'agent') return null
    return (
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {t('chat.toolBlock.suggestedTask.withdrawn')}{state.reason ? ` · ${state.reason}` : ''}
      </p>
    )
  }
  if (!actions) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        {unavailableReason ?? t('chat.toolBlock.suggestedTask.desktopOnly')}
      </p>
    )
  }
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={busy !== null} onClick={() => onRun('launch')}>
          {busy === 'launch' ? <Loader2 className="animate-spin" /> : null}
          {t('chat.toolBlock.suggestedTask.launch')}
        </Button>
        <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => onRun('dismiss')}>
          {t('chat.toolBlock.suggestedTask.dismiss')}
        </Button>
      </div>
      {failure ? <p role="alert" className="mt-1 break-words text-xs text-error">{failure}</p> : null}
    </>
  )
}
