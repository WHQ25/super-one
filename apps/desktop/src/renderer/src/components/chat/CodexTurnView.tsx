import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType, CodexCollabToolCallItem, CodexCommandExecutionItem, CodexPlanApprovalState, ImageGenerationItem, CodexMcpToolCallItem, CodexReasoningItem, CodexThreadItem } from '@superone/shared/agent-types'
import { BookOpenText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { CopyableMarkdown } from './CopyableMarkdown'
import { renderCodexItem, CodexCommandBlock } from './codex-item-renderer'
import { fileLinkComponents } from './chat-markdown-components'
import { CodexSubagentMarker, isSpawnReady, isSubagentFollowUp } from './CodexCollabBlock'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { ToolBlock } from './ToolBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { isAlwaysHiddenToolBlock, isHiddenToolBlock } from './tool-display'
import { isMediaGenerateImageTool, isMediaVideoStatusTool } from './media-generation'
import {
  isCodexConclusionSegment,
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
  splitTurnForCompactMode,
} from './compact-chat-mode'
import { summarizeCodexProcess } from './turn-process-stats'
import { TurnDetailSection } from './TurnDetailSection'
import { ToolName, ToolRow, ToolSummary } from './tool-row'

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

function isHiddenCodexMcpItem(item: CodexThreadItem): boolean {
  if (item.type !== 'mcp_tool_call') return false
  const toolName = `mcp__${item.server}__${item.tool}`
  if (isAlwaysHiddenToolBlock(toolName)) return true
  if (!isMediaGenerateImageTool(toolName) && !isMediaVideoStatusTool(toolName)) return false
  return isHiddenToolBlock(toolName, codexMcpItemResultText(item))
}

interface CodexAppToolGroupProps {
  appId: string
  items: CodexMcpToolCallItem[]
  isStreaming: boolean
  sealed: boolean
}

function sameItemReferences<T>(previous: T[], current: T[]): boolean {
  return previous.length === current.length && previous.every((item, index) => item === current[index])
}

const MemoCodexSubagentMarker = memo(CodexSubagentMarker)

const CodexAppToolGroup = memo(function CodexAppToolGroup({ appId, items, isStreaming, sealed }: CodexAppToolGroupProps) {
  const { t } = useTranslation()
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const appName = app?.manifest.name ?? appId
  const runningItem = useMemo(() => (isStreaming ? items.find((i) => i.status === 'in_progress') ?? null : null), [isStreaming, items])
  const [expanded, setExpanded] = useState(!!runningItem && !sealed)
  const failed = items.some((item) => item.status === 'failed' || !!item.error)
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
      <ToolRow
        icon={<MiniAppIcon appId={appId} className="size-3.5 shrink-0" />}
        tone={failed ? 'error' : 'default'}
        expandable
        expanded={expanded}
        onExpandedChange={setExpanded}
        details={(
          <div ref={scrollRef} className="max-h-30 space-y-0.5 overflow-y-auto">
            {items.map((item) => (
              <ToolBlock
                key={item.id}
                toolName={`mcp__${item.server}__${item.tool}`}
                toolUseId={item.id}
                input={safeStringify(item.arguments)}
                status={codexMcpToolStatus(item.status)}
                result={codexMcpItemResultText(item)}
                isError={item.status === 'failed' || !!item.error}
                grouped
              />
            ))}
          </div>
        )}
        detailsClassName="border-t border-border/40 p-1.5"
        mountDetails="expanded"
        className="my-0"
      >
        <ToolName streaming={!!runningItem && !failed} tone={failed ? 'error' : 'default'}>{appName}</ToolName>
        <ToolSummary>{t('chat.codex.appToolCalls', { count: items.length })}</ToolSummary>
      </ToolRow>

      {!expanded && runningItem && (
        <div className="mt-0.5">
          <ToolBlock
            toolName={`mcp__${runningItem.server}__${runningItem.tool}`}
            toolUseId={runningItem.id}
            input={safeStringify(runningItem.arguments)}
            status={codexMcpToolStatus(runningItem.status)}
            isError={runningItem.status === 'failed' || !!runningItem.error}
            grouped
          />
        </div>
      )}
    </div>
  )
}, (previous, current) => previous.appId === current.appId
  && previous.isStreaming === current.isStreaming
  && previous.sealed === current.sealed
  && sameItemReferences(previous.items, current.items))

interface CodexTurnViewProps {
  message: ChatMessageType
  isStreaming: boolean
  isLastAssistant: boolean
}

type CodexSegment =
  | { kind: 'item'; index: number }
  | { kind: 'group'; indices: number[] }
  | { kind: 'reasoning'; indices: number[]; startIndex: number }
  | { kind: 'subagent'; index: number }
  | { kind: 'app-tools'; appId: string; indices: number[] }

interface CodexTopology {
  segments: CodexSegment[]
  imageIndices: number[]
  hasAssistantMessage: boolean
  lastPlanItemId?: string
}

const EMPTY_CODEX_ITEMS: CodexThreadItem[] = []

const COLLAPSIBLE_COMMAND_TYPES = new Set(['read', 'search'])

function isCollapsibleCommand(item: CodexThreadItem): item is CodexCommandExecutionItem {
  return item.type === 'command_execution' && COLLAPSIBLE_COMMAND_TYPES.has(item.commandActions?.[0]?.type ?? '')
}

function groupableAppIdForItem(
  item: CodexMcpToolCallItem,
  groupableAppByTool: ReadonlyMap<string, string>,
): string | null {
  if (item.server !== 'superone') return null
  // Fixed miniapp_call: appId + tool live in arguments
  if (item.tool === 'miniapp_call') {
    const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
      ? item.arguments as Record<string, unknown>
      : {}
    const appId = typeof args.appId === 'string' ? args.appId : ''
    const tool = typeof args.tool === 'string' ? args.tool : ''
    if (!appId || !tool) return null
    return groupableAppByTool.get(`${appId}\0${tool}`)
      ?? groupableAppByTool.get(`id:${appId}\0${tool}`)
      ?? null
  }
  // Legacy transcript: slug__tool
  const match = item.tool.match(/^(.+?)__(.+)$/)
  if (!match) return null
  return groupableAppByTool.get(`${match[1]}\0${match[2]}`) ?? null
}

function codexTopologyToken(
  item: CodexThreadItem,
  groupableAppByTool: ReadonlyMap<string, string>,
): string {
  if (item.type === 'command_execution') {
    return `${item.id}\0command_execution\0${item.commandActions?.[0]?.type ?? ''}`
  }
  if (item.type === 'mcp_tool_call') {
    return `${item.id}\0mcp_tool_call\0${isHiddenCodexMcpItem(item) ? 'hidden' : groupableAppIdForItem(item, groupableAppByTool) ?? ''}`
  }
  if (item.type === 'collab_tool_call') {
    return `${item.id}\0collab_tool_call\0${item.tool}\0${item.status}\0${item.receiverThreadIds.length}`
  }
  return `${item.id}\0${item.type}`
}

function buildCodexTopology(
  items: CodexThreadItem[],
  groupableAppByTool: ReadonlyMap<string, string>,
): CodexTopology {
  const segments: CodexSegment[] = []
  const imageIndices: number[] = []
  let hasAssistantMessage = false
  let lastPlanItemId: string | undefined
  let cmdGroup: number[] = []
  let appGroup: number[] = []
  let appGroupId: string | null = null
  const flushCmd = (): void => {
    if (cmdGroup.length > 0) segments.push({ kind: 'group', indices: cmdGroup })
    cmdGroup = []
  }
  const flushAppGroup = (): void => {
    if (appGroup.length > 0 && appGroupId) {
      segments.push({ kind: 'app-tools', appId: appGroupId, indices: appGroup })
    }
    appGroup = []
    appGroupId = null
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type === 'agent_message' || item.type === 'plan') hasAssistantMessage = true
    if (item.type === 'plan') lastPlanItemId = item.id
    if (item.type === 'image_generation') {
      imageIndices.push(i)
      continue
    }
    if (item.type === 'todo_list' || item.type === 'video_generation') continue
    if (isHiddenCodexMcpItem(item)) continue

    const mcpItem = item.type === 'mcp_tool_call' ? item : null
    const appIdForItem = mcpItem ? groupableAppIdForItem(mcpItem, groupableAppByTool) : null
    if (appIdForItem && mcpItem) {
      flushCmd()
      if (appGroupId !== appIdForItem) flushAppGroup()
      appGroupId = appIdForItem
      appGroup.push(i)
    } else if (item.type === 'collab_tool_call' && item.tool === 'spawnAgent') {
      if (!isSpawnReady(item)) continue
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'subagent', index: i })
    } else if (item.type === 'collab_tool_call' && isSubagentFollowUp(item)) {
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'subagent', index: i })
    } else if (item.type === 'collab_tool_call') {
      if (item.tool === 'wait' && item.status !== 'in_progress') continue
      if (item.tool === 'closeAgent' || item.tool === 'resumeAgent') continue
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'item', index: i })
    } else if (isCollapsibleCommand(item)) {
      flushAppGroup()
      cmdGroup.push(i)
    } else if (item.type === 'reasoning') {
      flushCmd()
      flushAppGroup()
      const previous = segments[segments.length - 1]
      if (previous?.kind === 'reasoning') previous.indices.push(i)
      else segments.push({ kind: 'reasoning', indices: [i], startIndex: i })
    } else {
      flushCmd()
      flushAppGroup()
      segments.push({ kind: 'item', index: i })
    }
  }
  flushCmd()
  flushAppGroup()
  return { segments, imageIndices, hasAssistantMessage, lastPlanItemId }
}

function generateCommandGroupSummary(items: CodexCommandExecutionItem[], t: (key: string, options?: Record<string, unknown>) => string): string {
  let readCount = 0
  let searchCount = 0
  for (const item of items) {
    const t = item.commandActions?.[0]?.type
    if (t === 'read') readCount++
    else if (t === 'search') searchCount++
  }
  const read = readCount > 0 ? t('chat.codex.commandGroupRead', { count: readCount }) : ''
  const search = searchCount > 0 ? t('chat.codex.commandGroupSearch', { count: searchCount }) : ''
  return read && search ? t('chat.codex.commandGroupCombined', { read, search }) : read || search
}

const CodexCommandGroup = memo(function CodexCommandGroup({ items, isStreaming, sealed }: { items: CodexCommandExecutionItem[]; isStreaming: boolean; sealed: boolean }) {
  const { t } = useTranslation()
  const hasRunning = items.some((item) => isStreaming && item.status === 'in_progress')
  const failed = items.some((item) => item.status === 'failed' || (item.exitCode !== undefined && item.exitCode !== 0))
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
      <ToolRow
        icon={<BookOpenText className="size-3 shrink-0 text-muted-foreground" />}
        tone={failed ? 'error' : 'default'}
        expandable
        expanded={expanded}
        onExpandedChange={setExpanded}
        details={(
          <div className="space-y-0.5">
            {items.map((item, i) => (
              <CodexCommandBlock key={`${item.id}-${i}`} item={item} isStreaming={isStreaming} />
            ))}
          </div>
        )}
        detailsClassName="border-t border-border/40 p-1.5"
        mountDetails="expanded"
        className="my-0"
      >
        <ToolName streaming={hasRunning && !failed} tone={failed ? 'error' : 'default'}>
          {hasRunning
            ? `${t('chat.codex.exploringCode')}…`
            : failed
              ? t('chat.codex.exploreCode')
              : t('chat.codex.codeExplored')}
        </ToolName>
        <ToolSummary>{generateCommandGroupSummary(items, t)}</ToolSummary>
      </ToolRow>
    </div>
  )
}, (previous, current) => previous.isStreaming === current.isStreaming
  && previous.sealed === current.sealed
  && sameItemReferences(previous.items, current.items))

interface CodexReasoningSegmentProps {
  items: CodexReasoningItem[]
  isStreaming: boolean
  blockDone: boolean
  isFirst: boolean
}

const CodexReasoningSegment = memo(function CodexReasoningSegment({
  items,
  isStreaming,
  blockDone,
  isFirst,
}: CodexReasoningSegmentProps) {
  const text = items.map((item) => item.text).join('\n\n')
  const first = items[0]
  const last = items[items.length - 1]
  return (
    <ReasoningBlock
      text={text}
      startedAt={first.startedAt}
      endedAt={last.endedAt}
      blockDone={!isStreaming || blockDone}
      showContent={text.trim().length > 0}
      isFirst={isFirst}
    />
  )
}, (previous, current) => previous.isStreaming === current.isStreaming
  && previous.blockDone === current.blockDone
  && previous.isFirst === current.isFirst
  && sameItemReferences(previous.items, current.items))

interface CodexItemSegmentProps {
  item: CodexThreadItem
  index: number
  isStreaming: boolean
  nextItem?: CodexThreadItem
  onApprovePlan?: () => void
  onRejectPlan?: (feedback?: string) => void
  planApproval?: CodexPlanApprovalState
}

const CodexItemSegment = memo(function CodexItemSegment(props: CodexItemSegmentProps) {
  return renderCodexItem(
    props.item,
    props.index,
    props.isStreaming,
    props.nextItem,
    props.onApprovePlan,
    props.onRejectPlan,
    props.planApproval,
  )
})


export function CodexTurnView({ message, isStreaming, isLastAssistant }: CodexTurnViewProps) {
  const codex = message.metadata?.codex
  const detailChatMode = useAppStore((s) => s.detailChatMode)
  const selectedCodexCollaborationMode = useActiveSession((s) => s.selectedCodexCollaborationMode)
  const hasPendingInteraction = useActiveSession((s) => s.hasPendingInteraction)
  const approveCodexPlan = useChatStore((s) => s.approveCodexPlan)
  const rejectCodexPlan = useChatStore((s) => s.rejectCodexPlan)
  const apps = useMiniAppStore((s) => s.apps)
  const groupableAppByTool = useMemo(() => {
    const map = new Map<string, string>()
    for (const app of apps) {
      const slug = app.manifest.toolSlug ?? app.id
      for (const tool of app.manifest.tools ?? []) {
        if (!tool.groupable) continue
        // Keys for legacy slug__tool and fixed miniapp_call (appId/slug + tool)
        map.set(`${slug}\0${tool.name}`, app.id)
        map.set(`id:${app.id}\0${tool.name}`, app.id)
        if (slug !== app.id) map.set(`${app.id}\0${tool.name}`, app.id)
      }
    }
    return map
  }, [apps])
  const codexItems = codex?.items ?? EMPTY_CODEX_ITEMS
  const topologyKey = codexItems.map((item) => codexTopologyToken(item, groupableAppByTool)).join('\x01')
  const topologyCache = useRef<{
    key: string
    groupableAppByTool: ReadonlyMap<string, string>
    value: CodexTopology
  } | null>(null)
  if (
    !topologyCache.current
    || topologyCache.current.key !== topologyKey
    || topologyCache.current.groupableAppByTool !== groupableAppByTool
  ) {
    topologyCache.current = {
      key: topologyKey,
      groupableAppByTool,
      value: buildCodexTopology(codexItems, groupableAppByTool),
    }
  }
  const topology = topologyCache.current.value

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

  const { segments, imageIndices, hasAssistantMessage, lastPlanItemId } = topology
  const planApproval = codex.planApproval
  const canRespondToPlan = !planApproval && !isStreaming && isLastAssistant && selectedCodexCollaborationMode === 'plan' && !hasPendingInteraction
  const fallbackText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')

  const imageItems = imageIndices.map((index) => codex.items[index] as ImageGenerationItem)

  const renderSegments = (segs: CodexSegment[], forceSealed: boolean): ReactNode[] =>
    segs.map((seg, segIdx) => {
      const sealed = forceSealed || !isStreaming || segIdx < segs.length - 1
      if (seg.kind === 'subagent') {
        const item = codex.items[seg.index] as CodexCollabToolCallItem
        return <MemoCodexSubagentMarker key={`sa-${item.id}`} item={item} />
      }
      if (seg.kind === 'group') {
        const items = seg.indices.map((index) => codex.items[index] as CodexCommandExecutionItem)
        if (items.length === 1) {
          return <CodexCommandBlock key={items[0].id} item={items[0]} isStreaming={isStreaming} />
        }
        return <CodexCommandGroup key={`cg-${seg.indices[0]}`} items={items} isStreaming={isStreaming} sealed={sealed} />
      }
      if (seg.kind === 'app-tools') {
        const items = seg.indices.map((index) => codex.items[index] as CodexMcpToolCallItem)
        if (items.length === 1) {
          return renderCodexItem(items[0], segIdx, isStreaming, codex.items[seg.indices[0] + 1])
        }
        return (
          <CodexAppToolGroup
            key={`atg-${seg.indices[0]}`}
            appId={seg.appId}
            items={items}
            isStreaming={isStreaming}
            sealed={sealed}
          />
        )
      }
      if (seg.kind === 'reasoning') {
        const items = seg.indices.map((index) => codex.items[index] as CodexReasoningItem)
        return (
          <CodexReasoningSegment
            key={`reasoning-${seg.startIndex}`}
            items={items}
            isStreaming={isStreaming}
            blockDone={sealed}
            isFirst={segIdx === 0}
          />
        )
      }
      if (seg.kind === 'item') {
        const item = codex.items[seg.index]
        return (
          <CodexItemSegment
            key={`${item.id}-${seg.index}`}
            item={item}
            index={seg.index}
            isStreaming={isStreaming}
            nextItem={codex.items[seg.index + 1]}
            onApprovePlan={item.type === 'plan' && item.id === lastPlanItemId && canRespondToPlan
              ? approveCodexPlan
              : undefined}
            onRejectPlan={item.type === 'plan' && item.id === lastPlanItemId && canRespondToPlan
              ? rejectCodexPlan
              : undefined}
            planApproval={item.type === 'plan' && item.id === lastPlanItemId
              ? planApproval
              : undefined}
          />
        )
      }
      return null
    })

  const body = (() => {
    if (!detailChatMode && !isStreaming) {
      const { process, conclusion } = splitTurnForCompactMode(
        segments,
        (seg) => isCodexConclusionSegment(seg, (index) => codex.items[index]?.type),
      )
      const showFallback = !hasAssistantMessage && !!fallbackText
      return (
        <>
          {process.length === 0
            ? null
            : process.length < MIN_PROCESS_SEGMENTS_TO_COLLAPSE
              ? (
                <div className="turn-process">
                  {renderSegments(process, true)}
                </div>
              )
              : (
                <TurnDetailSection stats={summarizeCodexProcess(process, codex.items)}>
                  {renderSegments(process, true)}
                </TurnDetailSection>
              )}
          {renderSegments(conclusion, true)}
          {showFallback && (
            <div className="my-0.5">
              <CopyableMarkdown text={fallbackText} isStreaming={false} components={fileLinkComponents} />
            </div>
          )}
        </>
      )
    }
    return (
      <>
        {renderSegments(segments, false)}
        {!isStreaming && !hasAssistantMessage && fallbackText && (
          <div className="my-0.5">
            <CopyableMarkdown text={fallbackText} isStreaming={isStreaming} components={fileLinkComponents} />
          </div>
        )}
      </>
    )
  })()

  return (
    <div
      className={cn(
        'codex-turn min-w-0 w-full',
        // Compact mode: no large gap between Detail disclosure and conclusion.
        !detailChatMode && !isStreaming ? 'space-y-1' : 'space-y-2',
      )}
    >
      {body}
      {imageItems.length > 0 && <ImageGalleryBlock items={imageItems} />}
    </div>
  )
}
