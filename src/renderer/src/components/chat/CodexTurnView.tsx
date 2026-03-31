import { useEffect, useState } from 'react'
import type { ChatMessage as ChatMessageType, CodexCollabToolCallItem, CodexCommandExecutionItem, CodexThreadItem } from '../../../../shared/agent-types'
import { ChevronRight, BookOpenText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyableMarkdown } from './CopyableMarkdown'
import { renderCodexItem, CodexCommandBlock } from './codex-item-renderer'
import { CodexCollabBlock } from './CodexCollabBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'

interface CodexTurnViewProps {
  message: ChatMessageType
  isStreaming: boolean
  isLastAssistant: boolean
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
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (hasRunning) setExpanded(true)
  }, [hasRunning])

  return (
    <div className="tool-group my-1 min-w-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <BookOpenText className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-foreground">
          {hasRunning && runningItem
            ? <>{runningItem.commandActions?.[0]?.type === 'read' ? 'Reading' : 'Searching'}…</>
            : generateCommandGroupSummary(items)}
        </span>
        <ChevronRight className={cn('ml-auto size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {items.map((item, i) => (
            <CodexCommandBlock key={`${item.id}-${i}`} item={item} isStreaming={isStreaming} />
          ))}
        </div>
      )}
    </div>
  )
}


export function CodexTurnView({ message, isStreaming, isLastAssistant }: CodexTurnViewProps) {
  const codex = message.metadata?.codex
  const selectedCodexCollaborationMode = useActiveSession((s) => s.selectedCodexCollaborationMode)
  const hasPendingInteraction = useActiveSession((s) => s.hasPendingInteraction)
  const approveCodexPlan = useChatStore((s) => s.approveCodexPlan)
  const rejectCodexPlan = useChatStore((s) => s.rejectCodexPlan)

  if (!codex) {
    if (isStreaming) return null

    return (
      <div className="codex-turn min-w-0 w-full my-0.5">
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

  const hasAssistantMessage = codex.items.some((i) => i.type === 'agent_message' || i.type === 'plan')
  const lastPlanItemId = [...codex.items].reverse().find((item) => item.type === 'plan')?.id
  const planApproval = codex.planApproval
  const canRespondToPlan = !planApproval && !isStreaming && isLastAssistant && selectedCodexCollaborationMode === 'plan' && !hasPendingInteraction
  const fallbackText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')

  type Segment =
    | { kind: 'item'; item: CodexThreadItem; index: number }
    | { kind: 'group'; items: CodexCommandExecutionItem[] }
    | { kind: 'collab'; items: CodexCollabToolCallItem[] }
  const segments: Segment[] = []
  let cmdGroup: CodexCommandExecutionItem[] = []
  let collabGroup: CodexCollabToolCallItem[] = []
  const flushCmd = () => { if (cmdGroup.length > 0) { segments.push({ kind: 'group', items: cmdGroup }); cmdGroup = [] } }
  const flushCollab = () => { if (collabGroup.length > 0) { segments.push({ kind: 'collab', items: collabGroup }); collabGroup = [] } }
  for (let i = 0; i < codex.items.length; i++) {
    const item = codex.items[i]
    if (item.type === 'reasoning' && !item.text) continue
    if (item.type === 'collab_tool_call' && item.tool === 'spawnAgent') {
      flushCmd()
      collabGroup.push(item)
    } else if (item.type === 'collab_tool_call') {
      flushCmd()
      flushCollab()
      segments.push({ kind: 'item', item, index: i })
    } else if (isCollapsibleCommand(item)) {
      flushCollab()
      cmdGroup.push(item)
    } else {
      flushCmd()
      flushCollab()
      segments.push({ kind: 'item', item, index: i })
    }
  }
  flushCmd()
  flushCollab()

  return (
    <div className="codex-turn min-w-0 w-full space-y-2">
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'collab') {
          return <CodexCollabBlock key={`cb-${segIdx}`} items={seg.items} isStreaming={isStreaming} />
        }
        if (seg.kind === 'group') {
          if (seg.items.length === 1) {
            return <CodexCommandBlock key={seg.items[0].id} item={seg.items[0]} isStreaming={isStreaming} />
          }
          return <CodexCommandGroup key={`cg-${segIdx}`} items={seg.items} isStreaming={isStreaming} />
        }
        if (seg.kind === 'item') {
          return renderCodexItem(
            seg.item,
            seg.index,
            isStreaming,
            codex.items[seg.index + 1],
            seg.item.type === 'plan' && seg.item.id === lastPlanItemId && canRespondToPlan
              ? approveCodexPlan
              : undefined,
            seg.item.type === 'plan' && seg.item.id === lastPlanItemId && canRespondToPlan
              ? rejectCodexPlan
              : undefined,
            seg.item.type === 'plan' && seg.item.id === lastPlanItemId
              ? planApproval
              : undefined,
          )
        }
        return null
      })}

      {!isStreaming && !hasAssistantMessage && fallbackText && (
        <div className="my-0.5">
          <CopyableMarkdown text={fallbackText} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}
