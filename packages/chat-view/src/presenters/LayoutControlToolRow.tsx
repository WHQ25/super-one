import { useTranslation } from 'react-i18next'
import { LAYOUT_ACT_ACTIONS, LAYOUT_CHAT_MODES, LAYOUT_CHAT_POSITIONS, type LayoutActAction } from '@superone/shared/layout-control'
import { ToolIcon } from './ToolIcon'
import type { ToolIcon as ToolIconName } from './tool-display'
import {
  CompactLabeledToolRow,
  ToolSummary,
  toolOutcomeLabel,
  toolRowTone,
  withStreamingEllipsis,
} from './ToolRow'

/** Bare names of the layout tools; both rows are drawn here on the desktop and the phone. */
export const LAYOUT_CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(['layout_snapshot', 'layout_act'])

const ACTIONS: ReadonlySet<string> = new Set(LAYOUT_ACT_ACTIONS)

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function iconFor(action: LayoutActAction | null): ToolIconName {
  switch (action) {
    case 'open_file': return 'file-text'
    case 'show_terminal':
    case 'hide_terminal': return 'terminal'
    default: return 'layout'
  }
}

/** A tab id read back for people: files by name, anything opaque (browser-<uuid>) not at all. */
function tabSubject(tab: string): string {
  if (tab.startsWith('file:')) return basename(tab.slice('file:'.length))
  return ''
}

function parseActResult(result: string | null | undefined): { status?: unknown; reason?: unknown; width?: unknown; height?: unknown } | null {
  if (!result) return null
  try {
    return JSON.parse(result) as { status?: unknown; width?: unknown; height?: unknown }
  } catch {
    // TOON snapshots and error text carry no outcome.
    return null
  }
}

/** The outcome worth telling the user beside the subject; a plain `applied` needs no words. */
export function layoutControlOutcome(result: string | null | undefined): 'queued' | 'skipped' | 'unsupported' | 'superseded' | null {
  const parsed = parseActResult(result)
  const status = parsed?.status
  if (status === 'skipped' && parsed?.reason === 'superseded') return 'superseded'
  return status === 'queued' || status === 'skipped' || status === 'unsupported' ? status : null
}

export interface LayoutControlToolRowProps {
  /** `layout_snapshot` or `layout_act`. */
  mcpToolName: string
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
}

/** One line per layout call: what changed, on what, and whether it waits for the user. */
export function LayoutControlToolRow({ mcpToolName, params, result, isStreaming, isError, isDenied }: LayoutControlToolRowProps) {
  const { t } = useTranslation()
  const rawAction = str(params.action)
  const action = mcpToolName === 'layout_act' && ACTIONS.has(rawAction) ? rawAction as LayoutActAction : null
  const keys = action ? `chat.toolBlock.layoutControl.actions.${action}` : 'chat.toolBlock.layoutControl.snapshot'

  let subject = ''
  if (action === 'close_split' && params.closeAll === true) {
    subject = t('chat.toolBlock.layoutControl.allSplits')
  } else if ((action === 'split_session' || action === 'close_split') && Array.isArray(params.sessionIds)) {
    subject = t('chat.toolBlock.layoutControl.sessionCount', { count: params.sessionIds.length })
  } else if (action === 'resize_splits' && Array.isArray(params.dividers)) {
    subject = t('chat.toolBlock.layoutControl.dividerCount', { count: params.dividers.length })
  } else if (action === 'open_file') {
    const path = str(params.path)
    subject = path ? `${basename(path)}${typeof params.line === 'number' ? `:${params.line}` : ''}` : ''
  } else if (action === 'panel_side') {
    const side = str(params.side)
    subject = side === 'left' || side === 'right' ? t(`chat.toolBlock.layoutControl.side.${side}`) : ''
  } else if (action === 'chat_mode') {
    const mode = str(params.mode)
    const position = str(params.position)
    subject = [
      (LAYOUT_CHAT_MODES as readonly string[]).includes(mode) ? t(`chat.toolBlock.layoutControl.chatMode.${mode}`) : '',
      (LAYOUT_CHAT_POSITIONS as readonly string[]).includes(position) ? t(`chat.toolBlock.layoutControl.chatPosition.${position}`) : '',
    ].filter(Boolean).join(' · ')
  } else if (action === 'resize_sidebar' || action === 'resize_panel' || action === 'resize_group') {
    // The applied size once known: the request is clamped to what the window allows.
    const applied = parseActResult(result)
    const px = (key: 'width' | 'height') => {
      const value = typeof applied?.[key] === 'number' ? applied[key] : params[key]
      return typeof value === 'number' ? value : null
    }
    const width = px('width')
    const height = action === 'resize_group' ? px('height') : null
    subject = width !== null && height !== null ? `${width} × ${height}px` : width !== null ? `${width}px` : height !== null ? `↕ ${height}px` : ''
  } else if (action) {
    subject = tabSubject(str(params.tab))
  }

  const outcome = !isStreaming && !isDenied && !isError ? layoutControlOutcome(result) : null

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
      summary={subject || undefined}
    >
      {/* Outside the truncating subject: a long path must not hide that the change is waiting. */}
      {outcome && <ToolSummary className="shrink-0">{t(`chat.toolBlock.layoutControl.outcome.${outcome}`)}</ToolSummary>}
    </CompactLabeledToolRow>
  )
}
