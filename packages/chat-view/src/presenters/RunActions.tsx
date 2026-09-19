/**
 * How a `*_run` block shows the steps it took.
 *
 * A run is one tool call that performs many actions, so the block stays a
 * single row and puts the actions behind its chevron — each worded as the
 * matching single-action call on that platform would word it. Collapsed, only
 * the count shows: the goal already uses the width, and the detail is one
 * click away.
 *
 * The three platforms share the loop, so they share these rows; only the
 * vocabulary differs (a browser clicks, a phone taps).
 */

import { useTranslation } from 'react-i18next'
import { MousePointer2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { JevRunAction } from '@superone/shared/agent-types'
import { SubagentScrollArea } from './SubagentBlock'
import { ToolName, ToolRow, ToolSummary } from './ToolRow'

/** The i18n keys one platform uses for the ops a run reports. */
export interface RunActionVocabulary {
  click: string
  type: string
  press: string
  scroll: string
  wait: string
  /** Scrolling has no element, so its direction reads as the target instead. */
  scrollUp: string
  scrollDown: string
  /** Plural key for the collapsed count's accessible name. */
  count: string
}

/** A long run is bounded and follows its tail, the way a subagent's calls are. */
export function RunActionRows({
  actions,
  icon,
  vocab,
}: {
  actions: JevRunAction[]
  icon: ReactNode
  vocab: RunActionVocabulary
}): ReactNode {
  const { t } = useTranslation()
  return (
    <SubagentScrollArea maxHeightClass="max-h-40" className="tool-rows space-y-0.5">
      {actions.map((action, i) => (
        <ToolRow key={i} icon={icon} showStatusBadge={false}>
          <ToolName>{t(vocab[action.op])}</ToolName>
          {action.target ? <ToolSummary>{runActionTarget(action, vocab, t)}</ToolSummary> : null}
        </ToolRow>
      ))}
    </SubagentScrollArea>
  )
}

/** How far a run has got, for the collapsed row's trailing slot. */
export function RunActionCount({
  count,
  vocab,
}: {
  count: number
  vocab: RunActionVocabulary
}): ReactNode {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground/70">
      <MousePointer2 className="size-3" aria-label={t(vocab.count, { count })} />
      {count}
    </span>
  )
}

function runActionTarget(
  action: JevRunAction,
  vocab: RunActionVocabulary,
  t: (key: string) => string,
): string {
  if (action.op !== 'scroll') return action.target ?? ''
  return t(action.target === 'up' ? vocab.scrollUp : vocab.scrollDown)
}
