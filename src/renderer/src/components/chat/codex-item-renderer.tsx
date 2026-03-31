import { Check, ClipboardList, Clock, Copy, Expand, MessageSquare, ScanSearch, TriangleAlert } from 'lucide-react'
import type { CodexCommandExecutionItem, CodexPlanApprovalState, CodexPlanItem, CodexThreadItem } from '../../../../shared/agent-types'
import { ToolBlock } from './ToolBlock'
import { CopyableMarkdown } from './CopyableMarkdown'
import { MarkdownView } from '@/components/MarkdownPreview'
import { ReasoningBlock } from './ReasoningBlock'
import { useActiveSession } from '@/stores/chat'
import { shortenPath } from './tool-display'
import type { ToolIcon as ToolIconName } from './tool-display'
import { ToolIcon } from './ToolIcon'
import { cn } from '@/lib/utils'
import { AnsiText } from '@/lib/ansi'
import { FileChip } from './ToolBlock'
import { FileIcon } from '@/components/ui/FileIcon'
import { CodexPlanImplementFooter } from './CodexPlanImplementFooter'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import type { CodexCollabToolCallItem } from '../../../../shared/agent-types'

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

function InlineFileChip({ name, filePath, lineNumber }: { name: string; filePath: string; lineNumber?: number }) {
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath
    useSourceControlStore.getState().selectFile(projectPath, relative, lineNumber)
    useAppStore.getState().setShowFilePanel(true)
    useAppStore.getState().setFilePanelView('file')
  }
  return (
    <span
      role="button"
      onClick={handleClick}
      title={filePath}
      className="inline-flex cursor-pointer items-center gap-0.5 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 transition-colors"
    >
      <FileIcon name={name} size={12} />
      <span>{name}</span>
      {lineNumber != null && <span className="text-muted-foreground text-[0.85em]">#L{lineNumber}</span>}
    </span>
  )
}

function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href, children, ...rest } = props
  const projectPath = useChatStore.getState().activeProject
  if (href && projectPath) {
    const lineMatch = href.match(/#L(\d+)$/)
    const cleanHref = lineMatch ? href.slice(0, -lineMatch[0].length) : href
    const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : undefined
    if (cleanHref.startsWith(projectPath + '/')) {
      const text = typeof children === 'string' ? children : (cleanHref.split('/').pop() || '')
      return <InlineFileChip name={text} filePath={cleanHref} lineNumber={lineNumber} />
    }
  }
  return <a href={href} {...rest}>{children}</a>
}

const codexComponents = { a: FileLink }

function StreamingAgentMessage({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return <CopyableMarkdown text={text} isStreaming={isStreaming} components={codexComponents} />
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

export function CodexCommandBlock({ item, isStreaming }: { item: CodexCommandExecutionItem; isStreaming: boolean }) {
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const display = getCommandDisplay(item, cwd, homedir)
  const action = item.commandActions?.[0]
  const autoExpandOnRun = action?.type !== 'read' && action?.type !== 'search'
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

  useEffect(() => {
    if (autoExpandOnRun) setExpanded(isRunning)
  }, [autoExpandOnRun, isRunning])
  const output = `${item.aggregatedOutput ?? ''}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim()

  return (
    <div className={cn('tool-node my-0.5 rounded transition-colors cursor-pointer hover:bg-muted/70 bg-muted/50', expanded && 'overflow-hidden')}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs" onClick={() => setExpanded((e) => !e)}>
        <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">
          {isRunning && !expanded ? <>{display.label === 'Bash' ? 'Running' : display.label === 'Read' ? 'Reading' : 'Searching'}…</> : display.label}
        </span>
        {(!expanded) && (
          action?.type === 'read' && action.path
            ? <FileChip name={action.path.split('/').pop() || ''} title={display.summary} filePath={action.path} />
            : <span className="min-w-0 truncate text-muted-foreground">{display.summary}</span>
        )}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      {expanded && (
        <div className="bg-[#0d1117] font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {item.command && (
            <div className="px-3 pt-2 text-[#e6edf3]">
              <span className="text-[#7ee787]">$ </span>{item.command}
            </div>
          )}
          <div className="max-h-24 overflow-y-auto overflow-x-auto px-3 py-1.5">
            {output ? (
              <div className="text-[#8b949e]"><AnsiText text={output} /></div>
            ) : isRunning ? (
              <div className="text-[#8b949e]"><span className="animate-shimmer">Running…</span></div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function CollabWaitBlock({ item }: { item: CodexCollabToolCallItem }) {
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

  const name = agentName ?? 'subagent'
  const label = elapsed >= 1 ? `Waiting for ${name} for ${elapsed}s...` : `Waiting for ${name}...`

  return (
    <div className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="size-3 animate-pulse" />
      <span>{label}</span>
    </div>
  )
}

function CollabSendInputBlock({ item }: { item: CodexCollabToolCallItem }) {
  const [expanded, setExpanded] = useState(false)
  const prompt = item.prompt ?? ''
  const receiverId = item.receiverThreadIds?.[0]
  const agentName = (receiverId && item.agentsStates[receiverId]?.nickname)
    || Object.values(item.agentsStates).find((s) => s.nickname)?.nickname
  const label = `Follow-up${agentName ? ` → ${agentName}` : ''}`
  return (
    <div className={cn('tool-node my-0.5 rounded transition-colors cursor-pointer hover:bg-muted/70 bg-muted/50', expanded && 'overflow-hidden')}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs" onClick={() => setExpanded((e) => !e)}>
        <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{label}</span>
        {!expanded && prompt && <span className="min-w-0 truncate text-muted-foreground">{prompt}</span>}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      {expanded && prompt && (
        <div className="bg-[#0d1117] px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-[#e6edf3] max-h-48 overflow-y-auto">
          {prompt}
        </div>
      )}
    </div>
  )
}

function PlanActionButton({ icon: Icon, onClick, title }: { icon: React.ElementType; onClick: (e: React.MouseEvent) => void; title: string }) {
  return (
    <button onClick={onClick} title={title} className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted">
      <Icon className="size-3" />
    </button>
  )
}

function PlanApprovalBadge({ planApproval }: { planApproval: CodexPlanApprovalState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        planApproval.status === 'approved'
          ? 'bg-green-500/10 text-green-400'
          : 'bg-red-500/10 text-red-400',
      )}
    >
      {planApproval.status === 'approved' ? 'Approved' : 'Rejected'}
    </span>
  )
}

function PlanApprovalSummary({ planApproval }: { planApproval: CodexPlanApprovalState }) {
  if (planApproval.status === 'approved') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-400">
        <Check className="size-3 shrink-0" />
        <span className="font-medium">Plan Approved</span>
      </div>
    )
  }

  return (
    <div className="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
      <div className="flex items-center gap-1.5">
        <TriangleAlert className="size-3 shrink-0" />
        <span className="font-medium">Plan Rejected</span>
      </div>
      {planApproval.feedback && (
        <div className="mt-1 text-red-400/75">{planApproval.feedback}</div>
      )}
    </div>
  )
}

function CodexPlanBlock({
  item,
  isStreaming,
  nextItem,
  onApprovePlan,
  onRejectPlan,
  planApproval,
}: {
  item: CodexPlanItem
  isStreaming: boolean
  nextItem?: CodexThreadItem
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}) {
  const isItemStreaming = isStreaming && !nextItem
  const [expanded, setExpanded] = useState(isItemStreaming)
  const [copied, setCopied] = useState(false)
  const planFullscreen = usePlanFullscreen()

  useEffect(() => {
    if (isItemStreaming) setExpanded(true)
  }, [isItemStreaming])

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(item.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation()
    planFullscreen.open(item.text, { onApprove: onApprovePlan, onReject: onRejectPlan, planApproval })
  }

  const handleApprove = () => {
    setExpanded(false)
    onApprovePlan?.()
  }

  const handleReject = (feedback?: string) => {
    setExpanded(false)
    onRejectPlan?.(feedback)
  }

  return (
    <div className={cn(
      'mb-0.5 mt-1 rounded border border-border/60 bg-muted/30 transition-colors hover:bg-muted/50 cursor-pointer',
      expanded && 'overflow-hidden',
    )}>
      <div className="flex items-center gap-1.5 px-2 py-2 text-xs" onClick={() => setExpanded((e) => !e)}>
        <ClipboardList className="size-3.5 shrink-0 text-blue-400" />
        <span className="font-medium text-foreground">Plan</span>
        {planApproval && <PlanApprovalBadge planApproval={planApproval} />}
        {!expanded && <span className="min-w-0 truncate text-muted-foreground">{item.text.split('\n')[0]}</span>}
        {!expanded && planApproval?.status === 'rejected' && planApproval.feedback && (
          <span className="min-w-0 truncate text-red-400/75">{planApproval.feedback}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {expanded && (
            <div className="flex items-center gap-0.5">
              <PlanActionButton icon={copied ? Check : Copy} onClick={handleCopy} title="Copy plan" />
              <PlanActionButton icon={Expand} onClick={handleFullscreen} title="Fullscreen" />
            </div>
          )}
        </div>
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded ? 'rotate-90' : 'ml-auto')} />
      </div>
      {expanded && (
        <>
          <div className="max-h-96 overflow-y-auto border-t border-border/50">
            <MarkdownView content={item.text} className="px-4 py-3 text-xs" />
          </div>
          {planApproval && (
            <div className="border-t border-border/50 px-3 py-2">
              <PlanApprovalSummary planApproval={planApproval} />
            </div>
          )}
          {!planApproval && onApprovePlan && onRejectPlan && (
            <div className="flex items-center justify-end border-t border-border/50 px-3 py-2">
              <CodexPlanImplementFooter onApprove={handleApprove} onReject={handleReject} />
            </div>
          )}
        </>
      )}
    </div>
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
          <StreamingAgentMessage text={item.text} isStreaming={isStreaming} />
        </div>
      )

    case 'reasoning':
      return (
        <ReasoningBlock
          key={`${item.id}-${index}`}
          text={item.text}
          blockDone={!isStreaming || !!nextItem}
        />
      )

    case 'plan':
      return (
        <CodexPlanBlock
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
            />
          ))}
        </div>
      )

    case 'mcp_tool_call':
      {
        const chunks: string[] = []
        if (item.result) chunks.push(safeStringify(item.result))
        if (item.error) chunks.push(`Error: ${item.error.message}`)
        const result = chunks.join('\n\n').trim()
        return (
          <ToolBlock
            key={`${item.id}-${index}`}
            toolName={`mcp__${item.server}__${item.tool}`}
            input={safeStringify(item.arguments)}
            status={toToolStatus(item.status)}
            result={result || undefined}
          />
        )
      }

    case 'web_search':
      return (
        <ToolBlock
          key={`${item.id}-${index}`}
          toolName="WebSearch"
          input={JSON.stringify({ query: item.query })}
          status="complete"
        />
      )

    case 'todo_list':
      return null

    case 'error':
      return (
        <div key={`${item.id}-${index}`} className="my-0.5 rounded bg-red-500/10 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-red-300">
            <TriangleAlert className="size-3.5" />
            <span>Codex Error</span>
          </div>
          <div className="text-[11px] leading-relaxed text-red-200">{item.message}</div>
        </div>
      )

    case 'review':
      return item.phase === 'entered' ? (
        <div key={`${item.id}-${index}`} className="my-1 flex items-center gap-2 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-300">
          <ScanSearch className="size-3.5 shrink-0" />
          <span className="font-medium">Start review{item.text ? ` — ${item.text}` : ''}</span>
        </div>
      ) : (
        <div key={`${item.id}-${index}`} className="my-1 flex items-center gap-2 rounded-md bg-green-500/10 px-2.5 py-1.5 text-xs text-green-300">
          <Check className="size-3.5 shrink-0" />
          <span className="font-medium">Review complete</span>
        </div>
      )

    case 'compaction':
      return (
        <div key={`${item.id}-${index}`} className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-green-400" />
          <span>Conversation compacted</span>
        </div>
      )

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
