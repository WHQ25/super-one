import { useState, useEffect } from 'react'
import type { ChatMessage as ChatMessageType, CodexCommandExecutionItem, CodexThreadItem } from '../../../../shared/agent-types'
import {
  Check,
  ChevronRight,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnsiText } from '@/lib/ansi'
import { ToolIcon } from './ToolIcon'
import type { ToolIcon as ToolIconName } from './tool-display'
import { shortenPath } from './tool-display'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ToolBlock, FileChip } from './ToolBlock'
import { CopyableMarkdown } from './CopyableMarkdown'
import { ReasoningBlock } from './ReasoningBlock'

interface CodexTurnViewProps {
  message: ChatMessageType
  isStreaming: boolean
}

type ItemStatus = 'in_progress' | 'completed' | 'failed'

function toToolStatus(status: ItemStatus): 'streaming' | 'complete' {
  return status === 'in_progress' ? 'streaming' : 'complete'
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserializable payload]'
  }
}

function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href, children, ...rest } = props
  const projectPath = useChatStore.getState().activeProject
  if (href && projectPath && href.startsWith(projectPath + '/')) {
    const text = typeof children === 'string' ? children : (href.split('/').pop() || '')
    return <span className="mt-1.5 inline-flex"><FileChip name={text} title={href} filePath={href} className="max-w-full" /></span>
  }
  return <a href={href} {...rest}>{children}</a>
}

const codexComponents = { a: FileLink }

function StreamingAgentMessage({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  return <CopyableMarkdown text={text} isStreaming={isStreaming} components={codexComponents} />
}

function getCommandDisplay(item: CodexCommandExecutionItem, cwd?: string, homedir?: string): { icon: ToolIconName; label: string; summary: string } {
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

const COLLAPSIBLE_COMMAND_TYPES = new Set(['read', 'search'])

function isCollapsibleCommand(item: CodexThreadItem): item is CodexCommandExecutionItem {
  return item.type === 'command_execution' && COLLAPSIBLE_COMMAND_TYPES.has(item.commandActions?.[0]?.type ?? '')
}

function generateCommandGroupSummary(items: CodexCommandExecutionItem[]): string {
  let readCount = 0
  let searchCount = 0
  for (const item of items) {
    const t = item.commandActions?.[0]?.type
    if (t === 'read') readCount++
    else if (t === 'search') searchCount++
  }
  const parts: string[] = []
  if (readCount > 0) parts.push(`read ${readCount} file${readCount > 1 ? 's' : ''}`)
  if (searchCount > 0) parts.push(`searched ${searchCount} code`)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function CodexCommandGroup({ items, isStreaming }: { items: CodexCommandExecutionItem[]; isStreaming: boolean }) {
  const hasRunning = items.some((item) => isStreaming && item.status === 'in_progress')
  const runningItem = hasRunning ? items.find((item) => item.status === 'in_progress') : null
  const [expanded, setExpanded] = useState(hasRunning)

  return (
    <div className="tool-group my-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
        <span className="min-w-0 truncate text-foreground">
          {hasRunning && runningItem
            ? <>{runningItem.commandActions?.[0]?.type === 'read' ? 'Reading' : 'Searching'}…</>
            : generateCommandGroupSummary(items)}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">{items.length} tool use</span>
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {items.map((item, i) => (
            <CodexCommandBlock key={`${item.id}-${i}`} item={item} isStreaming={isStreaming} />
          ))}
        </div>
      )}
      {!expanded && runningItem && (
        <div className="mt-0.5">
          <CodexCommandBlock item={runningItem} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}

function CodexCommandBlock({ item, isStreaming }: { item: CodexCommandExecutionItem; isStreaming: boolean }) {
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const display = getCommandDisplay(item, cwd, homedir)
  const action = item.commandActions?.[0]
  const isRunning = isStreaming && item.status === 'in_progress'
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(isRunning)
  }, [isRunning])
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

function renderItem(
  item: CodexThreadItem,
  index: number,
  isStreaming: boolean,
  nextItem?: CodexThreadItem,
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
        <ReasoningBlock key={`${item.id}-${index}`} text={item.text} blockDone={!isStreaming || !!nextItem} showContent={false} />
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
      {
        const completed = item.items.filter((todo) => todo.completed).length
        const result = item.items.map((todo) => `- [${todo.completed ? 'x' : ' '}] ${todo.text}`).join('\n')
        return (
          <ToolBlock
            key={`${item.id}-${index}`}
            toolName="TodoList"
            input={JSON.stringify({ total: item.items.length, completed })}
            status="complete"
            result={result || undefined}
          />
        )
      }

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
        <div key={`${item.id}-${index}`} className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Reviewing...</span>
        </div>
      ) : (
        <div key={`${item.id}-${index}`} className="my-0.5">
          <CopyableMarkdown text={item.text} isStreaming={isStreaming} />
        </div>
      )

    case 'compaction':
      return (
        <div key={`${item.id}-${index}`} className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-green-400" />
          <span>Conversation compacted</span>
        </div>
      )
  }
}

export function CodexTurnView({ message, isStreaming }: CodexTurnViewProps) {
  const codex = message.metadata?.codex

  if (!codex) {
    if (isStreaming) return null

    return (
      <div className="codex-turn my-0.5">
        <CopyableMarkdown
          text={message.content
            .filter((b) => b.type === 'text')
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('\n')}
          isStreaming={false}
        />
      </div>
    )
  }

  const hasAssistantMessage = codex.items.some((i) => i.type === 'agent_message')
  const fallbackText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')

  const segments: Array<{ kind: 'item'; item: CodexThreadItem; index: number } | { kind: 'group'; items: CodexCommandExecutionItem[] }> = []
  let group: CodexCommandExecutionItem[] = []
  const flushGroup = () => {
    if (group.length === 0) return
    segments.push({ kind: 'group', items: group })
    group = []
  }
  for (let i = 0; i < codex.items.length; i++) {
    const item = codex.items[i]
    if (isCollapsibleCommand(item)) {
      group.push(item)
    } else {
      flushGroup()
      segments.push({ kind: 'item', item, index: i })
    }
  }
  flushGroup()

  return (
    <div className="codex-turn space-y-2">
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'group') {
          if (seg.items.length === 1) {
            return <CodexCommandBlock key={seg.items[0].id} item={seg.items[0]} isStreaming={isStreaming} />
          }
          return <CodexCommandGroup key={`cg-${segIdx}`} items={seg.items} isStreaming={isStreaming} />
        }
        return renderItem(seg.item, seg.index, isStreaming, codex.items[seg.index + 1])
      })}

      {!isStreaming && !hasAssistantMessage && fallbackText && (
        <div className="my-0.5">
          <CopyableMarkdown text={fallbackText} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}
