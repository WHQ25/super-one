import { Check, Clock, MessageSquare, ScanSearch, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CodexCommandExecutionItem, CodexPlanApprovalState, CodexThreadItem } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'
import { CopyableMarkdown } from './CopyableMarkdown'
import { ReasoningBlock } from './ReasoningBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { resolveMarkdownLocalRefs } from './chat-shared'
import { shortenPath } from './tool-display'
import type { ToolIcon as ToolIconName } from './tool-display'
import { ToolIcon } from './ToolIcon'
import { cn } from '@superone/ui/lib/utils'
import { AnsiText } from '@/lib/ansi'
import { FileChip } from './ToolBlock'
import { CodexPlanImplementFooter } from './CodexPlanImplementFooter'
import { CodexPlanBlockPresenter } from './presenters/CodexPlanBlock'
import { CodexImageGenerationBlock } from './CodexImageGenerationBlock'
import { fileLinkComponents } from './chat-markdown-components'
import { createContext, memo, useContext, useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import type { CodexCollabToolCallItem } from '@superone/shared/agent-types'
import { TerminalCommandOutput } from './TerminalCommandOutput'
import { CompactLabeledToolRow, ToolName, ToolRow, ToolSummary, toolOutcomeLabel, withStreamingEllipsis } from './tool-row'
import { isCodexCommandToolError } from './codex-command-status'
import { CodexAsyncQuestionBlock } from './CodexAsyncQuestionBlock'

interface PlanFooterActions {
  onApprove?: () => void
  onReject?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}

type PlanFullscreenCtx = { open: (text: string, actions?: PlanFooterActions) => void }
const PlanFullscreenContext = createContext<PlanFullscreenCtx>({ open: () => {} })
export const usePlanFullscreen = () => useContext(PlanFullscreenContext)
export { PlanFullscreenContext }

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserializable payload]'
  }
}

type ItemStatus = 'in_progress' | 'completed' | 'failed'

function toToolStatus(status: ItemStatus): 'streaming' | 'complete' {
  return status === 'in_progress' ? 'streaming' : 'complete'
}

function StreamingAgentMessage({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const projectPath = useChatStore((s) => s.activeProject)
  const resolved = projectPath ? resolveMarkdownLocalRefs(text, projectPath) : text
  return <CopyableMarkdown text={resolved} isStreaming={isStreaming} components={fileLinkComponents} />
}

export function getCommandDisplay(item: CodexCommandExecutionItem, cwd?: string, homedir?: string): { icon: ToolIconName; label: string; summary: string } {
  const action = item.commandActions?.[0]
  const sp = (p: string): string => shortenPath(p, cwd, homedir)
  switch (action?.type) {
    case 'read':
      return { icon: 'file-text', label: 'Read', summary: action.path ? sp(action.path) : item.command }
    case 'search':
      return { icon: 'search', label: 'Grep', summary: `${action.query ?? ''}${action.path ? ` in ${sp(action.path)}` : ''}` }
    default:
      return { icon: 'terminal', label: 'Bash', summary: item.command }
  }
}

export const CodexCommandBlock = memo(function CodexCommandBlock({ item, isStreaming }: { item: CodexCommandExecutionItem; isStreaming: boolean }) {
  const { t } = useTranslation()
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const display = getCommandDisplay(item, cwd, homedir)
  const action = item.commandActions?.[0]
  const realRunning = item.status === 'in_progress'
  const [showRunning, setShowRunning] = useState(realRunning)

  useEffect(() => {
    if (realRunning) {
      setShowRunning(true)
      return
    }
    const id = setTimeout(() => setShowRunning(false), 500)
    return () => clearTimeout(id)
  }, [realRunning])

  const isRunning = isStreaming && showRunning
  const [expanded, setExpanded] = useState(false)
  const isToolError = isCodexCommandToolError(item)
  const tone = isToolError ? 'error' as const : 'default' as const
  const runningLabel = display.label === 'Bash'
    ? t('chat.codex.statusRunning')
    : display.label === 'Read'
      ? t('chat.codex.statusReading')
      : t('chat.codex.statusSearching')

  return (
    <ToolRow
      icon={<ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable
      details={<CodexCommandOutput item={item} isRunning={isRunning} />}
      detailsClassName=""
      mountDetails="expanded"
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      <ToolName streaming={isRunning} tone={tone}>
        {isRunning ? `${runningLabel}…` : display.label}
      </ToolName>
      {action?.type === 'read' && action.path
        ? <FileChip name={action.path.split('/').pop() || ''} title={display.summary} filePath={action.path} />
        : !expanded ? <ToolSummary>{display.summary}</ToolSummary> : null}
    </ToolRow>
  )
})

function CodexCommandOutput({ item, isRunning }: { item: CodexCommandExecutionItem; isRunning: boolean }) {
  const { t } = useTranslation()
  const output = `${item.aggregatedOutput ?? ''}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim()
  return (
    <TerminalCommandOutput command={item.command} hasOutput={!!output} outputVersion={output}>
      {output ? (
        <div className="text-terminal-muted"><AnsiText text={output} /></div>
      ) : isRunning ? (
        <div className="text-terminal-muted"><span className="animate-shimmer">{t('chat.codex.runningInline')}</span></div>
      ) : null}
    </TerminalCommandOutput>
  )
}

function CollabWaitBlock({ item }: { item: CodexCollabToolCallItem }) {
  const { t } = useTranslation()
  const agentName = Object.values(item.agentsStates).find((s) => s.nickname)?.nickname
  const isWaiting = item.status === 'in_progress'
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    if (!isWaiting) return
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isWaiting])

  if (!isWaiting) return null

  const name = agentName ?? t('chat.codex.fallbackAgentName')
  const label = withStreamingEllipsis(t('chat.codex.waitingFor', { name }), true)

  return (
    <CompactLabeledToolRow
      icon={<Clock className="size-3 shrink-0 animate-pulse text-muted-foreground" />}
      label={label}
      summary={elapsed >= 1 ? `${elapsed}s` : undefined}
      streaming
    />
  )
}

function CollabSendInputBlock({ item }: { item: CodexCollabToolCallItem }) {
  const { t } = useTranslation()
  const prompt = item.prompt ?? ''
  const receiverId = item.receiverThreadIds?.[0]
  const agentName = (receiverId && item.agentsStates[receiverId]?.nickname)
    || Object.values(item.agentsStates).find((s) => s.nickname)?.nickname
  const isRunning = item.status === 'in_progress'
  const tone = item.status === 'failed' ? 'error' as const : 'default' as const
  const label = withStreamingEllipsis(toolOutcomeLabel({
    streaming: isRunning,
    interrupted: item.status === 'failed',
    streamingLabel: t('chat.codex.sendingFollowUp'),
    actionLabel: t('chat.codex.sendFollowUp'),
    doneLabel: t('chat.codex.followUpSent'),
  }), isRunning)
  return (
    <ToolRow
      icon={<MessageSquare className="size-3 shrink-0 text-muted-foreground" />}
      tone={tone}
      expandable={!!prompt}
      details={prompt}
      detailsClassName="max-h-48 overflow-y-auto whitespace-pre-wrap bg-terminal-bg px-3 py-2 font-mono text-xs leading-relaxed text-terminal-fg"
      mountDetails="expanded"
    >
      <ToolName streaming={isRunning} tone={tone}>{label}</ToolName>
      {agentName || prompt ? <ToolSummary>{agentName || prompt}</ToolSummary> : null}
    </ToolRow>
  )
}

function DesktopCodexPlanBlock({
  item,
  isStreaming,
  nextItem,
  onApprovePlan,
  onRejectPlan,
  planApproval,
}: {
  item: Extract<CodexThreadItem, { type: 'plan' }>
  isStreaming: boolean
  nextItem?: CodexThreadItem
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}) {
  const planFullscreen = usePlanFullscreen()
  return (
    <CodexPlanBlockPresenter
      item={item}
      isStreaming={isStreaming}
      hasFollowingItem={Boolean(nextItem)}
      planApproval={planApproval}
      onApprovePlan={onApprovePlan}
      onRejectPlan={onRejectPlan}
      onOpenFullscreen={(text, actions) => planFullscreen.open(text, actions)}
      renderApprovalActions={({ onApprove, onReject }) => (
        <CodexPlanImplementFooter onApprove={onApprove} onReject={onReject} />
      )}
      Markdown={({ text, isStreaming: streaming }) => (
        <CopyableMarkdown text={text} isStreaming={streaming} components={fileLinkComponents} />
      )}
    />
  )
}

export function renderCodexItem(
  item: CodexThreadItem,
  index: number,
  isStreaming: boolean,
  nextItem?: CodexThreadItem,
  onApprovePlan?: () => void,
  onRejectPlan?: (feedback?: string) => void,
  planApproval?: CodexPlanApprovalState,
) {
  switch (item.type) {
    case 'agent_message':
      return (
        <div key={`${item.id}-${index}`} className="my-0.5">
          {item.questions?.length
            ? <CodexAsyncQuestionBlock item={item} />
            : <StreamingAgentMessage text={item.text} isStreaming={isStreaming} />}
        </div>
      )

    case 'reasoning':
      return (
        <ReasoningBlock
          key={`${item.id}-${index}`}
          text={item.text}
          startedAt={item.startedAt}
          endedAt={item.endedAt}
          blockDone={!isStreaming || !!nextItem}
          showContent={item.text.trim().length > 0}
        />
      )

    case 'plan':
      return (
        <DesktopCodexPlanBlock
          key={`${item.id}-${index}`}
          item={item}
          isStreaming={isStreaming}
          nextItem={nextItem}
          onApprovePlan={onApprovePlan}
          onRejectPlan={onRejectPlan}
          planApproval={planApproval}
        />
      )

    case 'command_execution':
      return <CodexCommandBlock key={`${item.id}-${index}`} item={item} isStreaming={isStreaming} />

    case 'file_change':
      if (item.changes.length === 0) {
        return (
          <ToolBlock
            key={`${item.id}-${index}`}
            toolName="FileChange"
            input={JSON.stringify({})}
            status="complete"
            result={item.status === 'failed' ? 'Failed to apply file changes.' : undefined}
            isError={item.status === 'failed'}
          />
        )
      }
      return (
        <div key={`${item.id}-${index}`} className="space-y-0.5">
          {item.changes.map((change, i) => (
            <ToolBlock
              key={`${item.id}-${index}-${i}`}
              toolName="FileChange"
              input={JSON.stringify({ file_path: change.path, kind: change.kind, diff: change.diff ?? '' })}
              status="complete"
              result={item.status === 'failed' && i === 0 ? 'Failed to apply file changes.' : undefined}
              isError={item.status === 'failed'}
            />
          ))}
        </div>
      )

    case 'mcp_tool_call':
      {
        const chunks: string[] = []
        if (item.result) {
          const contentArr = item.result.content as Array<{ type: string; text: string }> | undefined
          const textParts = contentArr?.filter((c) => c.type === 'text').map((c) => c.text)
          chunks.push(textParts?.length ? textParts.join('\n') : safeStringify(item.result))
        }
        if (item.error) chunks.push(`Error: ${item.error.message}`)
        const result = chunks.join('\n\n').trim()
        return (
          <ToolBlock
            key={`${item.id}-${index}`}
            toolName={`mcp__${item.server}__${item.tool}`}
            input={safeStringify(item.arguments)}
            status={toToolStatus(item.status)}
            result={result || undefined}
            isError={item.status === 'failed' || !!item.error}
          />
        )
      }

    case 'web_search':
      return (
        <ToolBlock
          key={`${item.id}-${index}`}
          toolName="WebSearch"
          input={JSON.stringify({ query: item.query })}
          status={toToolStatus(item.status)}
          isError={item.status === 'failed'}
        />
      )

    case 'image_generation':
      return <CodexImageGenerationBlock key={`${item.id}-${index}`} item={item} />

    case 'todo_list':
    case 'video_generation':
      return null

    case 'error':
      return <CodexErrorBlock key={`${item.id}-${index}`} message={item.message} />

    case 'review':
      return <CodexReviewBlock key={`${item.id}-${index}`} phase={item.phase} text={item.text} />

    case 'compaction':
      return <CodexCompactionBlock key={`${item.id}-${index}`} />

    case 'collab_tool_call':
      if (item.tool === 'wait') {
        return <CollabWaitBlock key={`${item.id}-${index}`} item={item} />
      }
      if (item.tool === 'sendInput') {
        return <CollabSendInputBlock key={`${item.id}-${index}`} item={item} />
      }
      return null
  }
}

function CodexErrorBlock({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="my-0.5 rounded bg-error/10 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-error">
        <TriangleAlert className="size-3.5" />
        <span>{t('chat.codex.codexError')}</span>
      </div>
      <div className="text-xs leading-relaxed text-red-200">{message}</div>
    </div>
  )
}

function CodexReviewBlock({ phase, text }: { phase: string; text?: string }) {
  const { t } = useTranslation()
  return phase === 'entered' ? (
    <div className="my-1 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
      <ScanSearch className="size-3.5 shrink-0" />
      <span className="font-medium">{t('chat.codex.startReview')}{text ? ` — ${text}` : ''}</span>
    </div>
  ) : (
    <div className="my-1 flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-1.5 text-xs text-success">
      <Check className="size-3.5 shrink-0" />
      <span className="font-medium">{t('chat.codex.reviewComplete')}</span>
    </div>
  )
}

function CodexCompactionBlock() {
  const { t } = useTranslation()
  return (
    <div className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3.5 text-success" />
      <span>{t('chat.codex.conversationCompacted')}</span>
    </div>
  )
}
