import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage as ChatMessageType, CodexCollabToolCallItem, CodexCommandExecutionItem, ImageGenerationItem, CodexMcpToolCallItem, CodexReasoningItem, CodexThreadItem } from '@superone/shared/agent-types'
import { ChevronRight, BookOpenText } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { CopyableMarkdown } from './CopyableMarkdown'
import { renderCodexItem, CodexCommandBlock } from './codex-item-renderer'
import { fileLinkComponents } from './chat-markdown-components'
import { CodexSubagentMarker, isSpawnReady, isSubagentFollowUp } from './CodexCollabBlock'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { ToolBlock } from './ToolBlock'
import { ReasoningBlock } from './ReasoningBlock'

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

function codexMcpToolStatus(status: CodexMcpToolCallItem['status']): 'streaming' | 'complete' {
  return status === 'in_progress' ? 'streaming' : 'complete'
}

function codexMcpItemResultText(item: CodexMcpToolCallItem): string | undefined {
  const chunks: string[] = []
  if (item.result) {
    const contentArr = item.result.content as Array<{ type: string; text: string }> | undefined
    const textParts = contentArr?.filter((c) => c.type === 'text').map((c) => c.text)
    chunks.push(textParts?.length ? textParts.join('\n') : safeStringify(item.result))
  }
  if (item.error) chunks.push(`Error: ${item.error.message}`)
  const text = chunks.join('\n\n').trim()
  return text.length > 0 ? text : undefined
}

interface CodexAppToolGroupProps {
  appId: string
  items: CodexMcpToolCallItem[]
  isStreaming: boolean
  sealed: boolean
}

function CodexAppToolGroup({ appId, items, isStreaming, sealed }: CodexAppToolGroupProps) {
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const appName = app?.manifest.name ?? appId
  const runningItem = useMemo(() => (isStreaming ? items.find((i) => i.status === 'in_progress') ?? null : null), [isStreaming, items])
  const [expanded, setExpanded] = useState(!!runningItem && !sealed)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => { if (sealed) setExpanded(false) }, [sealed])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    isNearBottomRef.current = true
    const handleScroll = (): void => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [expanded])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  })

  return (
    <div className="tool-group my-0.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 rounded bg-muted/50 px-2 py-1.5 text-xs transition-colors hover:bg-muted/70"
      >
        <MiniAppIcon appId={appId} className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{appName}</span>
        <span className="shrink-0 text-muted-foreground">·</span>
        <span className="text-muted-foreground">{items.length} tool call{items.length !== 1 ? 's' : ''}</span>
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div ref={scrollRef} className="mt-0.5 max-h-[120px] space-y-0.5 overflow-y-auto pl-2">
          {items.map((item) => (
            <ToolBlock
              key={item.id}
              toolName={`mcp__${item.server}__${item.tool}`}
              toolUseId={item.id}
              input={safeStringify(item.arguments)}
              status={codexMcpToolStatus(item.status)}
              result={codexMcpItemResultText(item)}
              grouped
            />
          ))}
        </div>
      )}

      {!expanded && runningItem && (
        <div className="mt-0.5">
          <ToolBlock
            toolName={`mcp__${runningItem.server}__${runningItem.tool}`}
            toolUseId={runningItem.id}
            input={safeStringify(runningItem.arguments)}
            status={codexMcpToolStatus(runningItem.status)}
            grouped
          />
        </div>
      )}
    </div>
  )
}

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

function CodexCommandGroup({ items, isStreaming, sealed }: { items: CodexCommandExecutionItem[]; isStreaming: boolean; sealed: boolean }) {
  const hasRunning = items.some((item) => isStreaming && item.status === 'in_progress')
  const runningItem = hasRunning ? items.find((item) => item.status === 'in_progress') : null
  const [expanded, setExpanded] = useState(hasRunning && !sealed)

  useEffect(() => {
    if (sealed) {
      setExpanded(false)
    } else if (hasRunning) {
      setExpanded(true)
    }
  }, [hasRunning, sealed])

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
  const apps = useMiniAppStore((s) => s.apps)

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
          components={fileLinkComponents}
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

  const groupableAppForMcpItem = (item: CodexMcpToolCallItem): string | null => {
    if (item.server !== 'superone') return null
    const match = item.tool.match(/^(.+?)__(.+)$/)
    if (!match) return null
    const [, slug, toolNamePart] = match
    const app = apps.find((a) => (a.manifest.toolSlug ?? a.id) === slug)
    if (!app) return null
    const toolDef = app.manifest.tools?.find((t) => t.name === toolNamePart)
    return toolDef?.groupable ? app.id : null
  }

  type Segment =
    | { kind: 'item'; item: CodexThreadItem; index: number }
    | { kind: 'group'; items: CodexCommandExecutionItem[] }
    | { kind: 'reasoning'; items: CodexReasoningItem[]; startIndex: number }
    | { kind: 'subagent'; item: CodexCollabToolCallItem }
    | { kind: 'app-tools'; appId: string; items: CodexMcpToolCallItem[] }
  const segments: Segment[] = []
  const imageItems: ImageGenerationItem[] = []
  let cmdGroup: CodexCommandExecutionItem[] = []
  let appGroup: CodexMcpToolCallItem[] = []
  let appGroupId: string | null = null
  const flushCmd = () => { if (cmdGroup.length > 0) { segments.push({ kind: 'group', items: cmdGroup }); cmdGroup = [] } }
  const flushAppGroup = () => {
    if (appGroup.length > 0 && appGroupId) { segments.push({ kind: 'app-tools', appId: appGroupId, items: appGroup }) }
    appGroup = []
    appGroupId = null
  }
  for (let i = 0; i < codex.items.length; i++) {
    const item = codex.items[i]
    if (item.type === 'image_generation') {
      imageItems.push(item)
      continue
    }
    const appIdForItem = item.type === 'mcp_tool_call' ? groupableAppForMcpItem(item) : null
    if (appIdForItem) {
      flushCmd()
      if (appGroupId !== appIdForItem) flushAppGroup()
      appGroupId = appIdForItem
      appGroup.push(item as CodexMcpToolCallItem)
    } else if (item.type === 'collab_tool_call' && item.tool === 'spawnAgent') {
      flushCmd()
      flushAppGroup()
      if (!isSpawnReady(item)) {
        continue
      }
      segments.push({ kind: 'subagent', item })
    } else if (item.type === 'collab_tool_call' && isSubagentFollowUp(item)) {
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'subagent', item })
    } else if (item.type === 'collab_tool_call') {
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'item', item, index: i })
    } else if (isCollapsibleCommand(item)) {
      flushAppGroup()
      cmdGroup.push(item)
    } else if (item.type === 'reasoning') {
      flushCmd()
      flushAppGroup()
      const previous = segments[segments.length - 1]
      if (previous?.kind === 'reasoning') previous.items.push(item)
      else segments.push({ kind: 'reasoning', items: [item], startIndex: i })
    } else {
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'item', item, index: i })
    }
  }
  flushCmd()
  flushAppGroup()

  return (
    <div className="codex-turn min-w-0 w-full space-y-2">
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'subagent') {
          return <CodexSubagentMarker key={`sa-${seg.item.id}`} item={seg.item} />
        }
        if (seg.kind === 'group') {
          if (seg.items.length === 1) {
            return <CodexCommandBlock key={seg.items[0].id} item={seg.items[0]} isStreaming={isStreaming} />
          }
          return <CodexCommandGroup key={`cg-${segIdx}`} items={seg.items} isStreaming={isStreaming} sealed={!isStreaming || segIdx < segments.length - 1} />
        }
        if (seg.kind === 'app-tools') {
          if (seg.items.length === 1) {
            return renderCodexItem(seg.items[0], segIdx, isStreaming, codex.items[codex.items.indexOf(seg.items[0]) + 1])
          }
          return (
            <CodexAppToolGroup
              key={`atg-${segIdx}`}
              appId={seg.appId}
              items={seg.items}
              isStreaming={isStreaming}
              sealed={!isStreaming || segIdx < segments.length - 1}
            />
          )
        }
        if (seg.kind === 'reasoning') {
          const text = seg.items.map((item) => item.text).join('\n\n')
          const first = seg.items[0]
          const last = seg.items[seg.items.length - 1]
          return (
            <ReasoningBlock
              key={`reasoning-${seg.startIndex}`}
              text={text}
              startedAt={first.startedAt}
              endedAt={last.endedAt}
              blockDone={!isStreaming || segIdx < segments.length - 1}
              showContent={text.trim().length > 0}
              isFirst={segIdx === 0}
            />
          )
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
          <CopyableMarkdown text={fallbackText} isStreaming={isStreaming} components={fileLinkComponents} />
        </div>
      )}

      {imageItems.length > 0 && <ImageGalleryBlock items={imageItems} />}
    </div>
  )
}
