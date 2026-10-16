import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { localSessionLink } from '@superone/shared/session-link'
import type { SuggestedTaskState } from '@superone/shared/suggested-task'
import { SessionChip } from './SessionChip'
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
  /** The host's launch pickers (agent, model, permission), beside the buttons of a pending card. */
  launchControls?: ReactNode
  /** Renders the brief; plain text when absent. */
  renderMarkdown?: (content: string) => ReactNode
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const icon = <ClipboardCheck className="size-3 shrink-0 text-muted-foreground" />

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
  launchControls,
  renderMarkdown,
}: SuggestedTaskCardProps) {
  const { t } = useTranslation()
  const [launching, setLaunching] = useState(false)
  const [failure, setFailure] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const title = str(params.title) || str(toolSummary)
  const tldr = str(params.tldr)
  const prompt = str(params.prompt)

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

  const launch = async () => {
    if (!actions || launching) return
    setLaunching(true)
    setFailure('')
    try {
      const error = await actions.launch()
      if (error) setFailure(error)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setLaunching(false)
    }
  }

  // A launched card's title is the chip to its session, outside the prompt
  // toggle: a link cannot sit inside a button.
  const launchedSessionId = state?.status === 'launched' ? state.sessionId : undefined
  const summary = (
    <>
      {launchedSessionId ? null : (
        <span className={cn('mt-1 block min-w-0 break-words text-sm font-medium', state?.status === 'dismissed' && 'text-muted-foreground line-through')}>
          {title}
        </span>
      )}
      {tldr ? (
        <span className={cn('mt-0.5 block break-words text-xs text-muted-foreground', prompt && 'transition-colors group-hover/summary:text-foreground')}>
          {tldr}
        </span>
      ) : null}
    </>
  )

  return (
    <div
      className={cn('tool-node my-1 min-w-0 overflow-hidden rounded-md border', state ? 'bg-muted/20' : 'bg-card')}
      data-suggested-task-status={state?.status ?? 'pending'}
    >
      <div className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {icon}
          <ToolName>{t('chat.toolBlock.suggestedTask.suggestedTask')}</ToolName>
          {state ? <StateBadge state={state} /> : null}
        </div>
        {launchedSessionId ? (
          <SessionChip href={localSessionLink(launchedSessionId)} label={title} size="title" className="mt-1" />
        ) : null}
        {prompt && (tldr || !launchedSessionId) ? (
          // The summary is the toggle: the full brief opens beneath it.
          <button
            type="button"
            aria-expanded={promptOpen}
            title={t(promptOpen ? 'chat.toolBlock.suggestedTask.hidePrompt' : 'chat.toolBlock.suggestedTask.showPrompt')}
            onClick={() => setPromptOpen((open) => !open)}
            className="group/summary block w-full min-w-0 cursor-pointer text-left"
          >
            {summary}
          </button>
        ) : summary}
        {prompt && promptOpen ? (
          <div className="mt-1.5 max-h-80 min-w-0 overflow-y-auto overscroll-contain rounded-md bg-muted/40 px-2.5 py-2">
            {renderMarkdown
              ? renderMarkdown(prompt)
              : <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{prompt}</p>}
          </div>
        ) : null}
      </div>
      <Footer
        state={state}
        launching={launching}
        failure={failure}
        actions={actions}
        unavailableReason={unavailableReason}
        launchControls={launchControls}
        onLaunch={launch}
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
  launching,
  failure,
  actions,
  unavailableReason,
  launchControls,
  onLaunch,
}: {
  state?: SuggestedTaskState
  launching: boolean
  failure: string
  actions?: SuggestedTaskActions
  unavailableReason?: string
  launchControls?: ReactNode
  onLaunch: () => void
}) {
  const { t } = useTranslation()
  if (state) return null
  if (!actions) {
    return (
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        {unavailableReason ?? t('chat.toolBlock.suggestedTask.desktopOnly')}
      </p>
    )
  }
  return (
    <div className="border-t bg-muted/30 px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {launchControls ? <div className="min-w-0 flex-1">{launchControls}</div> : null}
        <Button size="xs" className="ml-auto shrink-0" disabled={launching} onClick={onLaunch}>
          {launching ? <Loader2 className="animate-spin" /> : null}
          {t('chat.toolBlock.suggestedTask.launch')}
        </Button>
      </div>
      {failure ? <p role="alert" className="mt-1 break-words px-1 text-xs text-error">{failure}</p> : null}
    </div>
  )
}
