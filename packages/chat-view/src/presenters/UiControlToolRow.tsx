import { useTranslation } from 'react-i18next'
import { UI_ACT_ACTIONS, type UiActAction } from '@superone/shared/ui-control'
import { ToolIcon } from './ToolIcon'
import type { ToolIcon as ToolIconName } from './tool-display'
import {
  CompactLabeledToolRow,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

/** Bare names of the layout tools; both rows are drawn here on the desktop and the phone. */
export const UI_CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(['ui_snapshot', 'ui_act'])

const ACTIONS: ReadonlySet<string> = new Set(UI_ACT_ACTIONS)

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function iconFor(action: UiActAction | null): ToolIconName {
  switch (action) {
    case 'open_file': return 'file-text'
    case 'open_diff': return 'git-branch'
    case 'show_terminal':
    case 'hide_terminal': return 'terminal'
    default: return 'layout'
  }
}

/** A tab id read back for people: files and diffs by name, anything opaque (browser-<uuid>) not at all. */
function tabSubject(tab: string): string {
  if (tab.startsWith('file:')) return basename(tab.slice('file:'.length))
  if (tab.startsWith('diff:')) {
    const [scope, ...path] = tab.slice('diff:'.length).split(':')
    return path.length ? basename(path.join(':')) : scope === 'uncommitted' ? '' : scope.slice(0, 7)
  }
  return ''
}

/** The outcome worth telling the user beside the subject; a plain `applied` needs no words. */
export function uiControlOutcome(result: string | null | undefined): 'queued' | 'skipped' | 'unsupported' | null {
  if (!result) return null
  try {
    const status = (JSON.parse(result) as { status?: unknown }).status
    return status === 'queued' || status === 'skipped' || status === 'unsupported' ? status : null
  } catch {
    // TOON snapshots and error text carry no outcome.
    return null
  }
}

export interface UiControlToolRowProps {
  /** `ui_snapshot` or `ui_act`. */
  mcpToolName: string
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
}

/** One line per layout call: what changed, on what, and whether it waits for the user. */
export function UiControlToolRow({ mcpToolName, params, result, isStreaming, isError, isDenied }: UiControlToolRowProps) {
  const { t } = useTranslation()
  const rawAction = str(params.action)
  const action = mcpToolName === 'ui_act' && ACTIONS.has(rawAction) ? rawAction as UiActAction : null
  const keys = action ? `chat.toolBlock.uiControl.actions.${action}` : 'chat.toolBlock.uiControl.snapshot'

  let subject = ''
  if (action === 'open_file') {
    const path = str(params.path)
    subject = path ? `${basename(path)}${typeof params.line === 'number' ? `:${params.line}` : ''}` : ''
  } else if (action === 'open_diff') {
    const commit = str(params.commit).slice(0, 7)
    const path = str(params.path)
    subject = [commit, path ? basename(path) : ''].filter(Boolean).join(' · ')
      || (isStreaming ? '' : t('chat.toolBlock.uiControl.uncommitted'))
  } else if (action === 'panel_side') {
    const side = str(params.side)
    subject = side === 'left' || side === 'right' ? t(`chat.toolBlock.uiControl.side.${side}`) : ''
  } else if (action) {
    subject = tabSubject(str(params.tab))
  }

  const outcome = !isStreaming && !isDenied && !isError ? uiControlOutcome(result) : null
  const summary = [subject, outcome ? t(`chat.toolBlock.uiControl.outcome.${outcome}`) : ''].filter(Boolean).join(' · ')

  return (
    <CompactLabeledToolRow
      icon={<ToolIcon icon={iconFor(action)} className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(
        toolOutcomeLabel({
          streaming: isStreaming,
          interrupted: !!isDenied || !!isError,
          streamingLabel: t(`${keys}.streaming`),
          actionLabel: t(`${keys}.action`),
          doneLabel: t(`${keys}.done`),
        }),
        isStreaming,
      )}
      streaming={isStreaming}
      tone={toolRowTone(isDenied, isError)}
      summary={summary || undefined}
    />
  )
}
