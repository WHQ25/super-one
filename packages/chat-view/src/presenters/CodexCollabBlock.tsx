import type { ComponentType, ReactNode } from 'react'
import { Bot, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  CodexCollabToolCallItem,
  CodexThreadItem,
} from '@superone/shared/agent-types'
import {
  SubagentBlockPresenter,
  type SubagentColorClasses,
  type SubagentMarkdownProps,
} from './SubagentBlock'
import { ToolName, ToolRow, ToolSummary } from './ToolRow'

export const CODEX_COLLAB_ACTIVITY_TYPES = new Set<CodexThreadItem['type']>([
  'command_execution',
  'mcp_tool_call',
  'file_change',
  'web_search',
])

export interface CodexCollabViewModel {
  receiverId?: string
  colorKey: string
  childItems: CodexThreadItem[]
  activityItems: CodexThreadItem[]
  name: string
  role: string
  badge?: string
  prompt: string
  resultText?: string
  diagnostic?: string
  isRunning: boolean
  isComplete: boolean
  isFailed: boolean
  failureNotFound: boolean
  isStopped: boolean
  inputTokens?: number
  outputTokens?: number
}

export function codexCollabViewModel(item: CodexCollabToolCallItem): CodexCollabViewModel {
  const receiverId = item.receiverThreadIds[0] ?? Object.keys(item.agentsStates)[0]
  const state = receiverId ? item.agentsStates[receiverId] : undefined
  const childItems = receiverId ? item.childItems?.[receiverId] ?? [] : []
  const isFailed = item.status === 'failed' || state?.status === 'errored'
  const isComplete = item.status === 'completed' || state?.status === 'completed'
  const isStopped = !isFailed && (state?.status === 'shutdown' || state?.status === 'notFound')
  let resultText: string | undefined
  for (let index = childItems.length - 1; index >= 0; index -= 1) {
    const child = childItems[index]
    if (child.type === 'agent_message') {
      resultText = child.text
      break
    }
  }
  return {
    receiverId,
    colorKey: receiverId ?? item.id,
    childItems,
    activityItems: childItems.filter((child) => CODEX_COLLAB_ACTIVITY_TYPES.has(child.type)),
    name: state?.nickname ?? '',
    role: state?.role ?? 'agent',
    badge: state?.forkedFromId ? 'forked' : state?.role,
    prompt: item.prompt ?? '',
    resultText: resultText ?? state?.message,
    diagnostic: isFailed ? state?.message : undefined,
    isRunning: !isFailed && !isComplete && !isStopped,
    isComplete: isFailed || isComplete || isStopped,
    isFailed,
    failureNotFound: state?.status === 'notFound',
    isStopped,
    inputTokens: state?.tokens?.input,
    outputTokens: state?.tokens?.output,
  }
}

export interface CodexCollabBlockPresenterProps {
  item: CodexCollabToolCallItem
  colors: SubagentColorClasses
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  canOpenFullView?: boolean
  onOpenFullView?: () => void
  childContent?: ReactNode
  formatTokens: (tokens: number) => string
  Markdown: ComponentType<SubagentMarkdownProps>
}

/** Shared Codex collaboration card; hosts only own colors, navigation, and child rows. */
export function CodexCollabBlockPresenter({
  item,
  colors,
  expanded,
  onExpandedChange,
  canOpenFullView = false,
  onOpenFullView,
  childContent,
  formatTokens,
  Markdown,
}: CodexCollabBlockPresenterProps) {
  const { t } = useTranslation()
  const view = codexCollabViewModel(item)
  if (view.isFailed) {
    const detail = view.diagnostic?.trim()
      || (view.failureNotFound ? t('chat.codexCollab.failureNotFound') : t('chat.codexCollab.failureNoDetails'))
    const summary = t('chat.codexCollab.failureSummary', {
      tool: t(`chat.codexCollab.toolLabels.${item.tool}`),
      message: detail,
    })
    return (
      <ToolRow
        icon={<TriangleAlert className="size-3 shrink-0 text-warning" />}
        tone="error"
      >
        <ToolName tone="error">{view.name || t('chat.codexCollab.defaultName')}</ToolName>
        {view.badge ? <span className={`${colors.tagBg} ${colors.tagText} shrink-0 rounded px-1 py-px text-xs`}>{view.badge === 'forked' ? t('chat.codexCollab.forked') : view.badge}</span> : null}
        <ToolSummary>{summary}</ToolSummary>
      </ToolRow>
    )
  }
  return (
    <SubagentBlockPresenter
      toolUseId={item.id}
      taskInput={{
        name: view.name,
        teamName: '',
        description: '',
        subagentType: view.badge === 'forked' ? t('chat.codexCollab.forked') : view.badge ?? view.role,
        prompt: view.prompt,
      }}
      colors={colors}
      isAsync={false}
      isRunning={view.isRunning}
      isComplete={view.isComplete}
      isFailed={view.isFailed}
      isStopped={view.isStopped}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      canOpenFullView={canOpenFullView}
      onOpenFullView={onOpenFullView ?? (() => undefined)}
      initialElapsed={0}
      stats={{
        toolCalls: view.activityItems.length,
        inputTokens: view.inputTokens,
        outputTokens: view.outputTokens,
      }}
      childContent={childContent}
      resultText={view.resultText}
      diagnostic={view.diagnostic}
      formatTokens={formatTokens}
      Markdown={Markdown}
    />
  )
}
