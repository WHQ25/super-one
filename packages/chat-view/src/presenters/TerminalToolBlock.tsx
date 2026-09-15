import { SquareTerminal } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolName, ToolRow, ToolSummary, toolOutcomeLabel, withStreamingEllipsis, type ToolRowTone } from './ToolRow'
import {
  describeTerminalActions,
  parseTerminalResult,
  terminalTabsAction,
  type TerminalOp,
} from './terminal-tool-display'

export interface TerminalToolBlockPresenterProps {
  op: TerminalOp
  params: Record<string, unknown>
  result?: string
  toolSummary?: string
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
  onExpandedChange?: (expanded: boolean) => void
  pendingDetails?: ReactNode
  /** Host hook: reveal the tab in the terminal panel. Omitted on hosts without one. */
  onRevealTab?: (terminalId: string) => void
}

/** Lines of the post-call screen kept in the expand body. */
const SCREEN_TAIL_LINES = 24

type LabelKey = 'list' | 'run' | 'attach' | 'close' | 'snapshot' | 'act' | 'waitFor'

function labelKey(op: TerminalOp, params: Record<string, unknown>): LabelKey {
  return op === 'tabs' ? terminalTabsAction(params) : op
}

/**
 * One row per `terminal_*` call: what the agent did to which tab, with the screen it
 * saw afterwards behind expand. Rejections (command exited, user took over, declined)
 * use the denied tone so the user can see the agent was stopped, not that it failed.
 */
export function TerminalToolBlockPresenter(props: TerminalToolBlockPresenterProps) {
  const { t } = useTranslation()
  const { op, params, result, isStreaming, isError, isDenied, allowExpand = true, toolSummary } = props
  const outcome = useMemo(() => parseTerminalResult(result), [result])
  const rejected = outcome.status === 'rejected' || outcome.status === 'cancelled'
  const failed = !!isError || outcome.status === 'error' || !!result?.startsWith('[Error]')
  const tone: ToolRowTone = isDenied || rejected ? 'denied' : failed ? 'error' : 'default'
  const key = labelKey(op, params)

  const label = withStreamingEllipsis(
    toolOutcomeLabel({
      streaming: isStreaming,
      interrupted: tone !== 'default',
      streamingLabel: t(`chat.toolBlock.terminal.${key}.streaming`),
      actionLabel: t(`chat.toolBlock.terminal.${key}.action`),
      doneLabel: t(`chat.toolBlock.terminal.${key}.done`),
    }),
    isStreaming,
  )

  const description = typeof params.description === 'string' ? params.description : ''
  const command = typeof params.command === 'string' ? params.command : ''
  const tab = typeof outcome.data?.tab === 'string' ? outcome.data.tab : typeof params.tab === 'string' ? params.tab : ''
  const summary = (() => {
    if (description) return description
    if (key === 'run') return command
    if (key === 'list') return outcome.listCount === null ? '' : t('chat.toolBlock.terminal.tabCount', { count: outcome.listCount })
    if (key === 'attach') return typeof outcome.data?.command === 'string' ? outcome.data.command : tab
    if (key === 'close') {
      const closed = Array.isArray(outcome.data?.closed) ? outcome.data.closed.length : null
      return closed === null ? tab : t('chat.toolBlock.terminal.tabCount', { count: closed })
    }
    if (key === 'snapshot') return (Array.isArray(params.include) && params.include.length ? params.include : ['screen']).join(' · ')
    if (key === 'act') return describeTerminalActions(params.actions, t)
    if (key === 'waitFor') {
      const waits: string[] = []
      if (typeof params.text === 'string') waits.push(`“${params.text}”`)
      if (typeof params.textGone === 'string') waits.push(t('chat.toolBlock.terminal.waitGone', { text: params.textGone }))
      if (typeof params.idleMs === 'number') waits.push(t('chat.toolBlock.terminal.waitIdle', { ms: params.idleMs }))
      if (params.exited === true) waits.push(t('chat.toolBlock.terminal.waitExited'))
      return waits.join(' · ')
    }
    return toolSummary ?? ''
  })()

  const reasonText = rejected && outcome.reason
    ? t(`chat.toolBlock.terminal.reasons.${outcome.reason}`, { defaultValue: outcome.reason })
    : null
  const errorText = failed && result ? result.replace(/^\[Error\]\s*/, '') : null
  const screen = outcome.screen && outcome.screen.length ? outcome.screen.slice(-SCREEN_TAIL_LINES) : null
  const scrollback = typeof outcome.data?.scrollback === 'string' ? outcome.data.scrollback : null
  const details = reasonText || errorText || screen || scrollback
    ? (
      <div className="space-y-1.5">
        {reasonText && <p className="text-error">{reasonText}</p>}
        {errorText && <p className="whitespace-pre-wrap break-words text-warning">{errorText}</p>}
        {(scrollback ?? screen) && (
          <pre className="max-h-72 overflow-auto rounded bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground/85 whitespace-pre">
            {scrollback ?? screen!.join('\n')}
          </pre>
        )}
        {tab && props.onRevealTab && (
          <button type="button" className="text-muted-foreground underline" onClick={(e) => { e.stopPropagation(); props.onRevealTab?.(tab) }}>
            {t('chat.toolBlock.terminal.revealTab')}
          </button>
        )}
      </div>
    )
    : props.pendingDetails

  return (
    <ToolRow
      icon={<SquareTerminal className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={allowExpand && !isStreaming && !!details}
      details={details}
      onExpandedChange={props.onExpandedChange}
      mountDetails="expanded"
    >
      <ToolName streaming={isStreaming} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
    </ToolRow>
  )
}
