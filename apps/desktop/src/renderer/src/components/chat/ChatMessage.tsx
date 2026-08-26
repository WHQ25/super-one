import type { ChatMessage as ChatMessageType, ContentBlock, AgentStatus, ImageGenerationItem, VideoGenerationItem, ImageAttachment } from '@superone/shared/agent-types'
import { useState, useEffect, useRef, useMemo, useCallback, memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Loader2, ImageIcon, OctagonX, Folder, ChevronRight, Clock, Minimize2, ArrowUp, ArrowDown, Copy, Check, AlertTriangle, X, Bot, Inbox } from 'lucide-react'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { AppToolGroup } from './AppToolGroup'
import { parseToolInput, parseMcpToolName, isHiddenToolBlock } from './tool-display'
import { isWorkflowSmokeCheck } from './workflow-utils'
import {
  countVisibleClaudeProcessSegments,
  isClaudeConclusionSegment,
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
  splitTurnForCompactMode,
} from './compact-chat-mode'
import { summarizeClaudeProcess } from './turn-process-stats'
import { TurnDetailSection } from './TurnDetailSection'
import { toImageGenerationItems, toVideoStatusItems, isMediaGenerateImageTool, isMediaVideoStatusTool, isGrokVideoGenTool, isWidgetShowTool, nativeWidgetImages, nativeWidgetVideos, collectCodexGeneratedImages, collectCodexGeneratedVideos } from './media-generation'
import { useMiniAppStore } from '@/stores/miniapp'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { SubagentBlock } from './SubagentBlock'
import { isSubagentToolName } from './subagent-utils'
import { WorkflowBlock } from './WorkflowBlock'
import { CodexTurnView } from './CodexTurnView'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { VideoGalleryBlock } from './VideoGalleryBlock'
import { AttachmentChip, AttachmentPreviewDialog } from './attachment-chip'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { UserSelectionChip } from './UserSelectionChip'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { FileText } from 'lucide-react'
import { MentionChipContent, isBlendedMentionKind, mentionChipIcon } from './MentionChip'
import { PasteChipPreview } from './PasteChipPreview'
import { PASTE_CHIP_LINE_THRESHOLD, PASTE_CHIP_CHAR_THRESHOLD } from './paste-chip-node'
import { toast } from 'sonner'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { getAssistantCopyText } from './chat-message/getAssistantCopyText'
import {
  formatTokens,
  resolveMarkdownLocalRefs,
} from './chat-shared'
import { RewindButton } from './RewindButton'
import { ForkButton } from './ForkButton'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { tryCopy } from '@/lib/clipboard'
import { MessageErrorBadge } from './MessageErrorBadge'
import { CopyableMarkdown } from './CopyableMarkdown'
import { CollabTaskBubble } from './CollabTaskBubble'
import { CopyButton, useCopyText } from './chat-message/copy-button'
import { fileLinkComponents } from './chat-markdown-components'
import { ReasoningBlock } from './ReasoningBlock'
import { parseUserMentions, type UserMentionKind } from './user-mention-parser'
import { replaceMiniAppTagsWithMention } from '@superone/shared/miniapp-prompt-tags'
import { deriveColors, ContextPreviewContent } from './ContextChip'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useIsDark } from '@/hooks/use-is-dark'
import type { ChatMessageContext } from '@superone/shared/agent-types'

interface ChatMessageProps {
  message: ChatMessageType
  sessionStatus: AgentStatus
  isLastAssistant: boolean
  hideUserActions?: boolean
}

/** Tools whose consecutive calls can be collapsed into a summary group. */
const COLLAPSIBLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])

type RenderSegment =
  | { kind: 'block'; block: ContentBlock; index: number }
  | { kind: 'thinking'; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'tools'; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'app-tools'; appId: string; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'subagent'; taskBlock: ContentBlock & { type: 'tool_use' }; childBlocks: ContentBlock[]; resultBlock?: ContentBlock; startIndex: number }
  | { kind: 'workflow'; toolBlock: ContentBlock & { type: 'tool_use' }; resultBlock?: ContentBlock; startIndex: number }

interface GroupResult {
  segments: RenderSegment[]
  toolNameMap: Map<string, string>
  toolResultMap: Map<string, string>
  timedOutToolIds: Set<string>
  errorToolIds: Set<string>
  outputPathMap: Map<string, string>
}

/** Group consecutive collapsible tool blocks and subagent blocks; everything else stays individual. */
export function groupContent(content: ContentBlock[], apps: MiniAppEntry[]): GroupResult {
  const toolNameMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  const timedOutToolIds = new Set<string>()
  const errorToolIds = new Set<string>()
  const outputPathMap = new Map<string, string>()
  const taskToolUseIds = new Set<string>()
  for (const block of content) {
    if (block.type === 'tool_use') {
      toolNameMap.set(block.toolUseId, block.toolName)
      if (isSubagentToolName(block.toolName)) taskToolUseIds.add(block.toolUseId)
    } else if (block.type === 'tool_result') {
      if (block.summary) toolResultMap.set(block.toolUseId, block.summary)
      if (block.isTimedOut) timedOutToolIds.add(block.toolUseId)
      if (block.isError) errorToolIds.add(block.toolUseId)
      if (block.outputPath) outputPathMap.set(block.toolUseId, block.outputPath)
    }
  }

  // Build a set of tool_use IDs that belong to groupable app tools
  const appToolIdToAppId = new Map<string, string>()
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const mcp = parseMcpToolName(block.toolName)
    if (!mcp || mcp.serverName !== 'superone') continue
    let params: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(block.input)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed
    } catch { /* streaming partial input */ }
    const resolved = resolveMiniAppToolIdentity(mcp.mcpToolName, params, apps)
    if (!resolved) continue
    const toolDef = resolved.toolDef
    // Standalone tools own their entire chat block (an iframe) — never group them,
    // grouping would defeat the purpose of inline custom UI per call.
    if (toolDef?.standalone) continue
    if (toolDef?.groupable) appToolIdToAppId.set(block.toolUseId, resolved.appId)
  }

  const segments: RenderSegment[] = []
  let group: ContentBlock[] = []
  let groupStart = 0
  let appGroup: ContentBlock[] = []
  let appGroupId: string | null = null
  let appGroupStart = 0

  // Active subagent collectors: taskToolUseId → segment reference
  const activeSubagents = new Map<string, RenderSegment & { kind: 'subagent' }>()
  // Active workflow collectors: workflow toolUseId → segment reference
  const activeWorkflows = new Map<string, RenderSegment & { kind: 'workflow' }>()
  // Every Agent tool_use (any nesting depth) → its immediate parentToolUseId,
  // used to walk a nested sub-agent's output back up to its top-level ancestor.
  const agentToParent = new Map<string, string | null>()
  const topAncestorSubagent = (parentId: string | null): string | null => {
    let cur = parentId
    const seen = new Set<string>()
    while (cur && agentToParent.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      const p = agentToParent.get(cur) ?? null
      if (p == null) break
      cur = p
    }
    return cur && activeSubagents.has(cur) ? cur : null
  }

  const flush = () => {
    if (group.length === 0) return
    segments.push({ kind: 'tools', blocks: group, startIndex: groupStart })
    group = []
  }

  const flushAppGroup = () => {
    if (appGroup.length === 0) return
    segments.push({ kind: 'app-tools', appId: appGroupId!, blocks: appGroup, startIndex: appGroupStart })
    appGroup = []
    appGroupId = null
  }

  for (let i = 0; i < content.length; i++) {
    const block = content[i]

    // Route this block (and anything a nested sub-agent emitted, at any depth)
    // into its top-level ancestor subagent's flat subtree. SubagentBlock then
    // re-derives the nesting. Without this, deeper-than-one-level output leaks
    // out as top-level blocks of the main agent.
    const parentId = 'parentToolUseId' in block ? block.parentToolUseId ?? null : null
    if (parentId) {
      if (block.type === 'tool_use' && isSubagentToolName(block.toolName)) agentToParent.set(block.toolUseId, parentId)
      const top = topAncestorSubagent(parentId)
      if (top) {
        activeSubagents.get(top)!.childBlocks.push(block)
        continue
      }
    }

    // Attach a subagent's own tool_result. Do NOT remove it from activeSubagents:
    // a background (run_in_background) subagent returns its tool_result early
    // ("started… output_file") and then streams its real children AFTER it, so the
    // collector must stay open for the rest of the content, else every later child
    // (text, tools, nested agents) fails topAncestorSubagent and leaks to top level.
    if (block.type === 'tool_result' && taskToolUseIds.has(block.toolUseId) && activeSubagents.has(block.toolUseId)) {
      activeSubagents.get(block.toolUseId)!.resultBlock = block
      continue
    }

    // Start a new subagent segment for Agent/Task tool_use (Claude Agent, Grok spawn)
    if (block.type === 'tool_use' && isSubagentToolName(block.toolName)) {
      flush()
      flushAppGroup()
      const seg: RenderSegment & { kind: 'subagent' } = {
        kind: 'subagent',
        taskBlock: block,
        childBlocks: [],
        startIndex: i,
      }
      segments.push(seg)
      activeSubagents.set(block.toolUseId, seg)
      agentToParent.set(block.toolUseId, null)
      continue
    }

    // Workflow tool_result closes its workflow segment
    if (block.type === 'tool_result' && activeWorkflows.has(block.toolUseId)) {
      activeWorkflows.get(block.toolUseId)!.resultBlock = block
      activeWorkflows.delete(block.toolUseId)
      continue
    }

    // Live workflow runs → WorkflowBlock. Authoring smoke-check (validate_only)
    // stays a normal tool row so it does not look like an empty multi-agent run.
    if (
      block.type === 'tool_use'
      && block.toolName === 'Workflow'
      && !isWorkflowSmokeCheck(block.input)
    ) {
      flush()
      flushAppGroup()
      const seg: RenderSegment & { kind: 'workflow' } = {
        kind: 'workflow',
        toolBlock: block,
        startIndex: i,
      }
      segments.push(seg)
      activeWorkflows.set(block.toolUseId, seg)
      continue
    }

    // App tool grouping (separate from COLLAPSIBLE_TOOLS)
    if (block.type === 'tool_use' && appToolIdToAppId.has(block.toolUseId)) {
      flush()
      const blockAppId = appToolIdToAppId.get(block.toolUseId)!
      if (appGroupId !== blockAppId) {
        flushAppGroup()
        appGroupId = blockAppId
        appGroupStart = i
      }
      appGroup.push(block)
      continue
    }
    if (block.type === 'tool_result' && appToolIdToAppId.has(block.toolUseId)) {
      appGroup.push(block)
      continue
    }

    // Normal grouping for collapsible tools
    flushAppGroup()
    if (block.type === 'tool_use' && COLLAPSIBLE_TOOLS.has(block.toolName)) {
      if (group.length === 0) groupStart = i
      group.push(block)
    } else if (block.type === 'tool_result' && COLLAPSIBLE_TOOLS.has(toolNameMap.get(block.toolUseId) ?? '')) {
      group.push(block)
    } else if (
      (block.type === 'tool_use' && isHiddenToolBlock(block.toolName, toolResultMap.get(block.toolUseId))) ||
      (block.type === 'tool_result' && isHiddenToolBlock(toolNameMap.get(block.toolUseId) ?? '', toolResultMap.get(block.toolUseId)))
    ) {
      // Hidden tools render nothing — emit no segment so two thinking blocks
      // straddling one collapse into a single reasoning card instead of two.
      flush()
    } else if (block.type === 'thinking') {
      flush()
      const last = segments[segments.length - 1]
      if (last?.kind === 'thinking') last.blocks.push(block)
      else segments.push({ kind: 'thinking', blocks: [block], startIndex: i })
    } else {
      flush()
      segments.push({ kind: 'block', block, index: i })
    }
  }
  flush()
  flushAppGroup()
  return { segments, toolNameMap, toolResultMap, timedOutToolIds, errorToolIds, outputPathMap }
}

// Own component so the media-resolution regex is scoped to this block (memoized on text +
// projectPath by the React Compiler): a completed text block no longer re-runs the scan when a
// later block in the same streaming message mutates.
function TextBlock({ text, isStreaming, projectPath, afterThinking }: {
  text: string
  isStreaming: boolean
  projectPath?: string | null
  afterThinking?: boolean
}) {
  const resolved = projectPath ? resolveMarkdownLocalRefs(text, projectPath) : text
  return (
    <div className={afterThinking ? 'mt-1 after-thinking' : undefined}>
      <CopyableMarkdown text={resolved} isStreaming={isStreaming} components={fileLinkComponents} />
    </div>
  )
}

function renderBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap?: Map<string, string>,
  timedOutToolIds?: Set<string>,
  errorToolIds?: Set<string>,
  outputPathMap?: Map<string, string>,
  nextBlockType?: string,
  prevBlockType?: string,
  projectPath?: string | null,
) {
  switch (block.type) {
    case 'text':
      return (
        <TextBlock
          key={index}
          text={block.text}
          isStreaming={isStreaming}
          projectPath={projectPath}
          afterThinking={prevBlockType === 'thinking'}
        />
      )
    case 'image':
      return (
        <div
          key={index}
          className="my-1 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs text-foreground"
        >
          <ImageIcon className="size-3 shrink-0" />
          <span className="truncate">{block.name}</span>
        </div>
      )
    case 'document':
      return (
        <div
          key={index}
          className="my-1 flex items-center gap-1.5 rounded bg-muted/50 px-2 py-1 text-xs text-foreground"
        >
          <FileIcon name={block.name} size={14} />
          <span className="truncate">{block.name}</span>
        </div>
      )
    case 'tool_use': {
      const isBg = block.toolName === 'Bash' && (() => { const p = parseToolInput(block.input, block.toolName); return p.run_in_background === true || p.background === true })()
      return (
        <ToolBlock
          key={index}
          toolName={block.toolName}
          toolUseId={block.toolUseId}
          input={block.input}
          toolSummary={block.toolSummary}
          status={!isStreaming && block.status === 'streaming' ? undefined : block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap?.get(block.toolUseId)}
          isTimedOut={timedOutToolIds?.has(block.toolUseId)}
          isError={errorToolIds?.has(block.toolUseId)}
          resultOutputPath={outputPathMap?.get(block.toolUseId)}
          autoExpand={isBg ? false : undefined}
        />
      )
    }
    case 'thinking':
      return (
        <ReasoningBlock
          key={index}
          text={block.thinking}
          startedAt={block.startedAt}
          endedAt={block.endedAt}
          blockDone={!isStreaming || !!nextBlockType}
          showContent={block.thinking.trim().length > 0}
          isFirst={prevBlockType === undefined}
        />
      )
    case 'tool_result':
      // Normally rendered inside the parent ToolBlock via toolResultMap.
      // If orphaned (no matching tool_use), show a compact fallback.
      if (toolResultMap?.has(block.toolUseId)) return null
      if (!block.summary) return null
      return (
        <div key={index} className="my-0.5 overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {block.summary}
        </div>
      )
  }
}

function LongTextChip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lineCount = text.split('\n').length
  const preview = text.slice(0, 60).replace(/\n/g, ' ')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-foreground/15 bg-foreground/5 px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{preview}</span>
        <span className="ml-auto shrink-0 text-foreground/50">{lineCount} lines</span>
      </button>
      <PasteChipPreview open={open} onOpenChange={setOpen} text={text} />
    </>
  )
}

function RestContent({ rest, forcePlain }: { rest: string; forcePlain?: boolean }) {
  if (forcePlain) return <span className="user-text-rest">{rest}</span>
  const lineCount = rest.split('\n').length
  if (lineCount >= PASTE_CHIP_LINE_THRESHOLD || rest.length >= PASTE_CHIP_CHAR_THRESHOLD) return <LongTextChip text={rest} />
  return <span className="user-text-rest">{rest}</span>
}

function MentionInlineChip({ kind, value, displayName }: { kind: UserMentionKind; value: string; displayName?: string }) {
  // Mentions re-parsed from plain text only know directory via trailing `/`.
  // Older inserts (and some drop paths) lost that marker and rendered folders
  // as files. Stat extensionless file mentions once so real directories recover.
  const [resolvedKind, setResolvedKind] = useState<UserMentionKind>(kind)
  useEffect(() => {
    setResolvedKind(kind)
    if (kind !== 'file') return
    const bare = value.replace(/\/$/, '')
    const baseName = bare.split(/[/\\]/).pop() || bare
    if (!bare || baseName.includes('.')) return
    let cancelled = false
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const abs = bare.startsWith('/') ? bare : projectRoot ? `${projectRoot}/${bare}` : null
    if (!abs) return
    void window.app.pathStat(abs).then((stat) => {
      if (!cancelled && stat?.isDirectory) setResolvedKind('directory')
    })
    return () => { cancelled = true }
  }, [kind, value])

  const isBlendedChip = isBlendedMentionKind(resolvedKind)
  const display =
    resolvedKind === 'miniapp' || isBlendedChip
      ? (displayName || value)
      : (value.replace(/\/$/, '').split('/').pop() || value)

  if (resolvedKind === 'agent') {
    return (
      <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap break-normal rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-xs leading-5 text-primary">
        <span className="font-medium">@{display}</span>
      </span>
    )
  }

  // Same .mention-chip* CSS as composer — em-only, scales with Cmd+= zoom.
  // break-normal resists the bubble's break-all so multi-word labels stay one line.
  return (
    <MentionChipContent
      blended={isBlendedChip}
      kind={resolvedKind}
      className="break-normal"
      icon={
        resolvedKind === 'directory'
          ? <Folder className="text-primary" />
          : mentionChipIcon(resolvedKind, value, display)
      }
      label={display}
    />
  )
}

export function UserTextBlock({ text, isPaste }: { text: string; isPaste?: boolean }) {
  if (isPaste === true) return <LongTextChip text={text} />
  const segments = parseUserMentions(text)
  if (segments.length === 0) return null
  // Normal inline flow (see .user-text-with-mentions). Chip is display:inline
  // so its label owns the baseline; long rest text wraps beside the chip.
  return (
    <span className="user-text-with-mentions">
      {segments.map((seg, i) =>
        seg.type === 'mention'
          ? <MentionInlineChip key={i} kind={seg.kind} value={seg.value} displayName={seg.displayName} />
          : <RestContent key={i} rest={seg.text} forcePlain={isPaste === false} />
      )}
    </span>
  )
}

function MessageContextChipItem({ ctx }: { ctx: ChatMessageContext }) {
  const [open, setOpen] = useState(false)
  const isDark = useIsDark()
  const colors = deriveColors(ctx.color, isDark)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap cursor-pointer"
          style={{ background: `${colors.bg}cc`, border: `1px solid ${colors.bg}` }}
          onClick={() => setOpen(!open)}
        >
          <MiniAppIcon appId={ctx.appId} className="size-3 shrink-0" />
          <span style={{ color: colors.color }} className="font-medium">{ctx.appName}</span>
          {ctx.summary && (
            <>
              <span style={{ color: colors.labelColor, fontSize: 10 }}>·</span>
              <span style={{ color: colors.labelColor, fontSize: 11 }}>{ctx.summary}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ContextPreviewContent appName={ctx.appName} summary={ctx.summary} content={ctx.content} />
      </PopoverContent>
    </Popover>
  )
}

function MessageContextChips({ contexts }: { contexts: ChatMessageContext[] }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {contexts.map((ctx) => (
        <MessageContextChipItem key={ctx.appId} ctx={ctx} />
      ))}
    </div>
  )
}

export function parseCompactMarker(message: ChatMessageType): { trigger: string; preTokens: number; postTokens?: number; durationMs?: number } | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const match = firstBlock.text.match(/^__compact__:(manual|auto):(\d+)(?::(\d*):(\d*))?$/)
  if (!match) return null
  return {
    trigger: match[1],
    preTokens: parseInt(match[2], 10),
    postTokens: match[3] ? parseInt(match[3], 10) : undefined,
    durationMs: match[4] ? parseInt(match[4], 10) : undefined,
  }
}

export type TurnMetaMarker =
  | { kind: 'summary'; text: string }
  | { kind: 'recap'; text: string; auto?: boolean }

/** Grok turn summary / session recap system markers (not agent reply). */
export function parseTurnMetaMarker(message: ChatMessageType): TurnMetaMarker | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  // Inline parse keeps ChatMessage free of store imports (circular risk).
  // Must stay in sync with TURN_META_PREFIX / parseTurnMetaText in event-reducer/slash.ts.
  const prefix = '__turn_meta__:'
  if (!firstBlock.text.startsWith(prefix)) return null
  try {
    const raw = JSON.parse(firstBlock.text.slice(prefix.length)) as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (!text) return null
    if (raw.kind === 'summary') return { kind: 'summary', text }
    if (raw.kind === 'recap') {
      return {
        kind: 'recap',
        text,
        ...(typeof raw.auto === 'boolean' ? { auto: raw.auto } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Hide legacy `kind:summary` system rows when the same text already lives on
 * assistant `metadata.turnSummary` (above the footer) — prevents double Summary.
 * Recap markers are never redundant with turnSummary.
 */
export function isRedundantTurnSummaryMarker(
  meta: TurnMetaMarker,
  messages: readonly ChatMessageType[],
): boolean {
  if (meta.kind !== 'summary') return false
  const text = meta.text.trim()
  if (!text) return false
  return messages.some(
    (m) =>
      m.role === 'assistant'
      && m.providerId !== 'system'
      && (m.metadata?.turnSummary?.trim() ?? '') === text,
  )
}

/**
 * Standalone system marker row.
 * - `recap` — current session recap path
 * - `summary` — legacy only (no longer minted; new turns use metadata.turnSummary)
 */
export function TurnMetaIndicator({ meta }: { meta: TurnMetaMarker }) {
  const { t } = useTranslation()
  if (meta.kind === 'recap') {
    return (
      <div
        className="mt-0.5 mb-2.5 text-xs leading-snug text-muted-foreground"
        data-turn-meta="recap"
        role="note"
      >
        <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.recapLabel')}</span>
        {meta.text}
      </div>
    )
  }
  // Legacy history only — live path never mints kind:summary markers.
  return (
    <div
      className="my-0.5 text-xs leading-snug text-muted-foreground"
      data-turn-meta="summary"
      role="note"
    >
      <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.summaryLabel')}</span>
      {meta.text}
    </div>
  )
}

/** Shown while a manual Grok `/recap` RPC is in flight. */
export function RecappingIndicator() {
  const { t } = useTranslation()
  return (
    <div
      className="mt-0.5 mb-2.5 flex items-center gap-1.5 text-xs leading-snug text-muted-foreground"
      data-turn-meta="recap-pending"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/80" aria-hidden />
      <span className="font-medium text-muted-foreground/80">{t('chat.turnMeta.generatingRecap')}</span>
    </div>
  )
}

/** Grok last-turn summary, rendered above the assistant turn footer. */
export function TurnSummaryAboveFooter({ summary }: { summary: string }) {
  const { t } = useTranslation()
  const text = summary.trim()
  if (!text) return null
  return (
    <div
      className="mt-2 text-xs leading-snug text-muted-foreground"
      data-turn-meta="summary"
      role="note"
    >
      <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.summaryLabel')}</span>
      {text}
    </div>
  )
}

/** Format token count for compact display. */
export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/** Format a millisecond duration as "98s" / "1m 38s". */
export function formatCompactDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
}

export function CompactIndicator({
  trigger,
  preTokens,
  postTokens,
  durationMs,
  expanded,
  onToggle,
}: {
  trigger: string
  preTokens: number
  postTokens?: number
  durationMs?: number
  expanded?: boolean
  onToggle?: () => void
}) {
  const pillClass = 'inline-flex items-center whitespace-nowrap rounded bg-primary/15 px-1.5 py-px text-xs text-primary/80'
  return (
    <div className="my-0.5 flex items-start gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-xs">
      <Minimize2 className="mt-0.5 size-3 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-medium text-primary">Conversation compacted</span>
        <span className={pillClass}>{trigger === 'auto' ? 'auto' : 'manual'}</span>
        {preTokens > 0 && (
          <span className={pillClass}>
            {formatCompactTokens(preTokens)}
            {postTokens !== undefined ? ` → ${formatCompactTokens(postTokens)}` : ''}
          </span>
        )}
        {durationMs !== undefined && durationMs > 0 && (
          <span className={pillClass}>{formatCompactDuration(durationMs)}</span>
        )}
      </div>
      {onToggle && (
        <button onClick={onToggle} className="flex shrink-0 items-center gap-0.5 text-primary/60 transition-colors hover:text-primary">
          {expanded ? <ChevronRight className="size-3 -rotate-90" /> : <ChevronRight className="size-3 rotate-90" />}
          <span>{expanded ? 'Hide history' : 'Show history'}</span>
        </button>
      )}
    </div>
  )
}

export function CompactingIndicator() {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-warning" />
      <span className="font-medium text-warning">Compacting conversation…</span>
      {elapsed > 0 && <span className="text-warning/60">{elapsed}s</span>}
    </div>
  )
}

export function CompactErrorIndicator({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-error/10 px-2 py-1.5 text-xs">
      <AlertTriangle className="size-3 shrink-0 text-error" />
      <span className="font-medium text-error">Compaction failed</span>
      <span className="truncate text-error/60">{error}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-auto shrink-0 text-error/60 transition-colors hover:text-error">
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

export function ApiRetryIndicator({ info }: { info: { attempt: number; maxRetries?: number; delayMs: number; message?: string } }) {
  const [remaining, setRemaining] = useState(info.delayMs)
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setRemaining(info.delayMs)
    if (info.delayMs <= 0) return
    const id = setInterval(() => {
      const left = Math.max(0, info.delayMs - (Date.now() - startRef.current))
      setRemaining(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [info.attempt, info.delayMs])

  const secs = Math.ceil(remaining / 1000)

  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-warning" />
      <span className="font-medium text-warning" title={info.message}>
        Retrying API request ({info.attempt}{info.maxRetries ? `/${info.maxRetries}` : ''})… {secs > 0 && <>{secs}s</>}
      </span>
    </div>
  )
}

function collectGeneratedImages(content: ContentBlock[], toolResultMap: Map<string, string>): ImageGenerationItem[] {
  const items: ImageGenerationItem[] = []
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    // A native-template widget_show hands the gallery items the host already prepared, so an
    // agent-written provider adapter lands in the same surface as a built-in generation.
    if (isWidgetShowTool(block.toolName)) {
      items.push(...nativeWidgetImages(toolResultMap.get(block.toolUseId)))
      continue
    }
    if (!isMediaGenerateImageTool(block.toolName)) continue
    items.push(...toImageGenerationItems(
      block.toolUseId,
      parseToolInput(block.input, block.toolName),
      toolResultMap.get(block.toolUseId),
    ))
  }
  return items
}

/**
 * Collect the finished video cards for a turn.
 *
 * Only the completing status poll produces a card. A generation spans two tool calls and the poll
 * usually lands in a later message than the submit, so a placeholder emitted at submit time would
 * be stranded in an earlier message with no way to ever settle — the visible submit tool block is
 * the progress affordance instead.
 */
function collectGeneratedVideos(content: ContentBlock[], toolResultMap: Map<string, string>): VideoGenerationItem[] {
  const byId = new Map<string, VideoGenerationItem>()
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const result = toolResultMap.get(block.toolUseId)
    if (isWidgetShowTool(block.toolName)) {
      for (const item of nativeWidgetVideos(result)) byId.set(item.id, item)
      continue
    }
    // SuperOne async poll, or Grok native video tools that return a finished path.
    if (!isMediaVideoStatusTool(block.toolName) && !isGrokVideoGenTool(block.toolName)) continue
    for (const item of toVideoStatusItems(result)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

function collaborationLabelKey(message: ChatMessageType): string | null {
  const source = message.metadata?.source
  if (source === 'task-notification') return 'chat.collaboration.taskNotification'
  if (source !== 'collaboration') return null
  const collab = message.metadata?.collaboration
  if (collab?.kind === 'initial_task') return 'chat.collaboration.initialTask'
  if (collab?.direction === 'outbound') return 'chat.collaboration.toAgent'
  return 'chat.collaboration.fromAgent'
}

/** Host wake for session_collab mailbox — agent sees full prompt; UI shows a compact inbox row. */
function isCollabMailboxWakeText(text: string): boolean {
  // Prefer the host template phrase; tool names alone must not hide normal user questions.
  return /collaboration mailbox message is ready/i.test(text)
}

function ClaudeTurnBody({
  grouped,
  isStreaming,
  detailChatMode,
  projectPath,
}: {
  grouped: GroupResult
  isStreaming: boolean
  detailChatMode: boolean
  projectPath: string | null
}) {
  const segs = grouped.segments
  const segOpts = {
    isStreaming,
    forceSealed: false as boolean,
    toolResultMap: grouped.toolResultMap,
    timedOutToolIds: grouped.timedOutToolIds,
    errorToolIds: grouped.errorToolIds,
    outputPathMap: grouped.outputPathMap,
    projectPath,
  }
  if (!detailChatMode && !isStreaming) {
    const { process, conclusion } = splitTurnForCompactMode(segs, isClaudeConclusionSegment)
    const processOpts = {
      toolResultAt: (id: string) => grouped.toolResultMap.get(id),
      isHiddenTool: isHiddenToolBlock,
      isErrorTool: (id: string) => grouped.errorToolIds.has(id),
    }
    const visibleProcessCount = countVisibleClaudeProcessSegments(process, processOpts)
    const processStats = summarizeClaudeProcess(process, processOpts)
    return (
      <>
        {visibleProcessCount === 0
          ? null
          : visibleProcessCount < MIN_PROCESS_SEGMENTS_TO_COLLAPSE
            ? (
              <div className="turn-process">
                {renderClaudeSegments(process, { ...segOpts, forceSealed: true })}
              </div>
            )
            : (
              <TurnDetailSection stats={processStats}>
                {renderClaudeSegments(process, { ...segOpts, forceSealed: true })}
              </TurnDetailSection>
            )}
        {renderClaudeSegments(conclusion, { ...segOpts, forceSealed: true })}
      </>
    )
  }
  return renderClaudeSegments(segs, segOpts)
}

function renderClaudeSegments(
  segs: RenderSegment[],
  opts: {
    isStreaming: boolean
    forceSealed: boolean
    toolResultMap: Map<string, string>
    timedOutToolIds: Set<string>
    errorToolIds: Set<string>
    outputPathMap: Map<string, string>
    projectPath: string | null
  },
): ReactNode[] {
  const {
    isStreaming,
    forceSealed,
    toolResultMap,
    timedOutToolIds,
    errorToolIds,
    outputPathMap,
    projectPath,
  } = opts

  return segs.map((seg, segIdx) => {
    const sealed = forceSealed || !isStreaming || segIdx < segs.length - 1
    if (seg.kind === 'subagent') {
      return (
        <SubagentBlock
          key={`sa-${seg.startIndex}`}
          taskBlock={seg.taskBlock}
          childBlocks={seg.childBlocks}
          resultBlock={seg.resultBlock}
          isStreaming={isStreaming}
        />
      )
    }
    if (seg.kind === 'workflow') {
      return (
        <WorkflowBlock
          key={`wf-${seg.startIndex}`}
          toolBlock={seg.toolBlock}
          resultBlock={seg.resultBlock}
          isStreaming={isStreaming}
        />
      )
    }
    if (seg.kind === 'app-tools') {
      const appToolUseCount = seg.blocks.filter((b) => b.type === 'tool_use').length
      if (appToolUseCount <= 1) {
        return seg.blocks.map((block, i) =>
          renderBlock(block, seg.startIndex + i, isStreaming, toolResultMap, timedOutToolIds, errorToolIds, outputPathMap, seg.blocks[i + 1]?.type, seg.blocks[i - 1]?.type, projectPath),
        )
      }
      return (
        <AppToolGroup
          key={`atg-${seg.startIndex}`}
          appId={seg.appId}
          blocks={seg.blocks}
          sealed={sealed}
        />
      )
    }
    if (seg.kind === 'thinking') {
      const text = seg.blocks.map((b) => b.type === 'thinking' ? b.thinking : '').join('\n\n')
      const first = seg.blocks[0]
      const last = seg.blocks[seg.blocks.length - 1]
      return (
        <ReasoningBlock
          key={`th-${seg.startIndex}`}
          text={text}
          startedAt={first.type === 'thinking' ? first.startedAt : undefined}
          endedAt={last.type === 'thinking' ? last.endedAt : undefined}
          blockDone={sealed}
          showContent={text.trim().length > 0}
          isFirst={segIdx === 0}
        />
      )
    }
    if (seg.kind === 'block') {
      const nextSeg = segs[segIdx + 1]
      const prevSeg = segs[segIdx - 1]
      const nextType = nextSeg?.kind === 'block' ? nextSeg.block.type : nextSeg?.kind === 'thinking' ? 'thinking' : nextSeg?.kind === 'tools' ? nextSeg.blocks[0]?.type : nextSeg?.kind === 'subagent' ? 'tool_use' : undefined
      const prevType = prevSeg?.kind === 'block' ? prevSeg.block.type : prevSeg?.kind === 'thinking' ? 'thinking' : undefined
      return renderBlock(seg.block, seg.index, isStreaming, toolResultMap, timedOutToolIds, errorToolIds, outputPathMap, nextType, prevType, projectPath)
    }
    const toolUseCount = seg.blocks.filter((b) => b.type === 'tool_use').length
    if (toolUseCount <= 1) {
      return seg.blocks.map((block, i) =>
        renderBlock(block, seg.startIndex + i, isStreaming, toolResultMap, timedOutToolIds, errorToolIds, outputPathMap, seg.blocks[i + 1]?.type, seg.blocks[i - 1]?.type, projectPath),
      )
    }
    return (
      <ToolGroup
        key={`tg-${seg.startIndex}`}
        blocks={seg.blocks}
        sealed={sealed}
      />
    )
  })
}

export const ChatMessage = memo(function ChatMessage({ message, sessionStatus, isLastAssistant, hideUserActions }: ChatMessageProps) {
  const { t } = useTranslation()
  const projectPath = useChatStore((s) => s.activeProject)
  const detailChatMode = useAppStore((s) => s.detailChatMode)
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming' && sessionStatus === 'streaming' && isLastAssistant
  const isCodexMessage = !isUser && message.providerId === 'codex'
  const collabLabelKey = isUser ? collaborationLabelKey(message) : null
  const isCollab = collabLabelKey != null
  // Parent-handed launch task: right-aligned markdown bubble (see CollabTaskBubble).
  // Mailbox traffic keeps the compact left-aligned label + plain-text bubble below.
  const isInitialTask = isCollab && message.metadata?.collaboration?.kind === 'initial_task'
  // Require task-notification provenance so asking about session_collab_* tools
  // in a normal user bubble is never rewritten as a mailbox row.
  const isMailboxWake = isUser
    && message.metadata?.source === 'task-notification'
    && isCollabMailboxWakeText(
      message.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
    )
  // Copy text is only needed once the turn settles (the copy button is hidden while streaming),
  // so skip deriving the full concatenated text on every delta of the live message.
  const assistantCopyText = isStreaming ? undefined : getAssistantCopyText(message)

  const apps = useMiniAppStore((s) => s.apps)
  const [previewAtt, setPreviewAtt] = useState<ImageAttachment | null>(null)
  const grouped = useMemo(
    () => (isUser || isCodexMessage) ? null : groupContent(message.content, apps),
    [isUser, isCodexMessage, message.content, apps],
  )

  const codexItems = message.metadata?.codex?.items
  const generatedImages = useMemo(
    () => isCodexMessage
      ? collectCodexGeneratedImages(codexItems)
      : grouped ? collectGeneratedImages(message.content, grouped.toolResultMap) : [],
    [isCodexMessage, codexItems, grouped, message.content],
  )

  const generatedVideos = useMemo(
    () => isCodexMessage
      ? collectCodexGeneratedVideos(codexItems)
      : grouped ? collectGeneratedVideos(message.content, grouped.toolResultMap) : [],
    [isCodexMessage, codexItems, grouped, message.content],
  )

  const userText = useMemo(
    () => (isUser
      ? replaceMiniAppTagsWithMention(message.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n'))
      : ''),
    [isUser, message.content],
  )
  const { copied: userCopied, copy: copyUserText } = useCopyText()
  // Host mailbox wake: right-aligned like a user turn, but plain status text (no bubble / tool row).
  if (isMailboxWake) {
    return (
      <div className="mb-0.5 flex w-0 min-w-full justify-end">
        <div className="flex max-w-[90%] items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Inbox className="size-3 shrink-0 opacity-80" />
          <span className="shrink-0">{t('chat.collaboration.mailboxReady')}</span>
        </div>
      </div>
    )
  }

  if (isInitialTask) return <CollabTaskBubble text={userText} />

  return (
    <div className={cn('w-0 min-w-full flex', isUser ? (isCollab ? 'justify-start' : 'justify-end') : 'mb-2 justify-start')}>
      <div className={cn(isUser ? 'group/copy relative mb-0 flex min-w-0 max-w-[90%] flex-col' : 'w-full', isUser && !isCollab && 'items-end', isUser && isCollab && 'items-start')}>
        {isCollab && collabLabelKey && (
          <div className="mb-1 flex items-center gap-1 px-0.5 text-xs font-medium text-primary/80">
            <Bot className="size-3 shrink-0" />
            <span>{t(collabLabelKey)}</span>
          </div>
        )}
        <div
          className={cn(
            'min-w-0 text-sm',
            isUser
              ? cn(
                  'max-w-full overflow-hidden rounded-xl px-3 py-2 text-foreground break-all',
                  isCollab
                    ? 'border border-primary/25 bg-primary/5'
                    : 'bg-muted/80',
                )
              : 'assistant-reply w-full text-foreground'
          )}
        >
          {isUser
            ? <TooltipProvider delayDuration={200}>
                {message.userSelections && message.userSelections.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    <UserSelectionChip selections={message.userSelections} readOnly />
                  </div>
                )}
                {message.content.map((block, i) => {
                  if (block.type === 'image' || block.type === 'document') {
                    const att = message.attachments?.find((a) => (block.id ? a.id === block.id : a.name === block.name))
                    return att ? <AttachmentChip key={i} att={att} onOpen={() => setPreviewAtt(att)} /> : null
                  }
                  return block.type === 'text' ? <UserTextBlock key={i} text={block.text} isPaste={block.isPaste} /> : renderBlock(block, i, false)
                })}
                <AttachmentPreviewDialog attachment={previewAtt} onClose={() => setPreviewAtt(null)} />
              </TooltipProvider>
          : isCodexMessage
            ? <CodexTurnView message={message} isStreaming={isStreaming} isLastAssistant={isLastAssistant} />
            : (
              <ClaudeTurnBody
                grouped={grouped!}
                isStreaming={isStreaming}
                detailChatMode={detailChatMode}
                projectPath={projectPath}
              />
            )
        }
        {!isUser && generatedImages.length > 0 && <ImageGalleryBlock items={generatedImages} />}
        {!isUser && generatedVideos.length > 0 && <VideoGalleryBlock items={generatedVideos} />}
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <OctagonX className="size-3" />
            <span>Interrupted · What should I do instead?</span>
          </div>
        )}
        {!isUser && message.metadata?.turnSummary && (
          <TurnSummaryAboveFooter summary={message.metadata.turnSummary} />
        )}
        {!isUser && (
          <DurationFooter
            message={message}
            copyText={assistantCopyText}
            parentIsStreaming={isStreaming}
            className={message.metadata?.turnSummary ? 'mt-1' : undefined}
          />
        )}
      </div>
      {isUser && message.contexts && message.contexts.length > 0 && (
        <div className="mt-1.5">
          <MessageContextChips contexts={message.contexts} />
        </div>
      )}
      {isUser && !hideUserActions && !isCollab && (
        <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
          {message.checkpointId && <RewindButton checkpointId={message.checkpointId} rewound={message.rewound} className="opacity-100" />}
          {userText.length > 0 && <CopyButton copied={userCopied} onClick={() => copyUserText(userText)} className="opacity-100" />}
        </div>
      )}
      {isUser && isCollab && userText.length > 0 && (
        <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
          <CopyButton copied={userCopied} onClick={() => copyUserText(userText)} className="opacity-100" />
        </div>
      )}
      </div>
    </div>
  )
})

/** Token value with ↑ or ↓ arrow. Highlights while value is actively changing, fades after 1s of inactivity. */
function AnimatedToken({ value, direction, active }: { value: number; direction: 'up' | 'down'; active: boolean }) {
  const [flash, setFlash] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prevRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setFlash(false)
      clearTimeout(timerRef.current)
      prevRef.current = value
      return () => clearTimeout(timerRef.current)
    }
    if (value > prevRef.current && prevRef.current > 0) {
      setFlash(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlash(false), 1000)
    }
    prevRef.current = value
    return () => clearTimeout(timerRef.current)
  }, [active, value])

  if (value <= 0) return null

  const isUp = direction === 'up'
  const flashColor = isUp ? 'text-primary' : 'text-emerald-400'
  const shouldFlash = active && flash

  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums transition-colors duration-500', shouldFlash && flashColor)}>
      {isUp
        ? <ArrowUp className={cn('size-3 transition-transform duration-300', shouldFlash && 'scale-110')} />
        : <ArrowDown className={cn('size-3 transition-transform duration-300', shouldFlash && 'scale-110')} />
      }
      <span>{formatTokens(value)}</span>
    </span>
  )
}

const TERMINAL_REASON_LABELS: Record<string, string> = {
  max_turns: 'Max turns',
  aborted_tools: 'Aborted',
  blocking_limit: 'Blocked',
  api_error: 'API Error',
}
function formatTerminalReason(reason: string): string {
  return TERMINAL_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

const ZERO_TOKENS = { input: 0, output: 0 }
const STATIC_FOOTER = { isCompacting: false, pendingApproval: false, streamingTokens: ZERO_TOKENS }

function DurationFooter({
  message,
  copyText,
  parentIsStreaming,
  className,
}: {
  message: ChatMessageType
  copyText?: string
  parentIsStreaming: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const runningSlashCommand = useActiveSession((s) => s.runningSlashCommand)
  const [reauthBusy, setReauthBusy] = useState(false)
  const handleReauth = useCallback(async (names: string[]) => {
    if (!activeProject) return
    setReauthBusy(true)
    try {
      for (const name of names) {
        const res = await window.app.codexMcpServerOauthLogin(activeProject, name, sessionApiProviderId ?? null)
        if (res.success) toast.success(t('chat.codex.mcpReauthSuccess', { name }))
        else toast.error(t('chat.codex.mcpReauthFailed', { name, error: res.error ?? '' }))
      }
    } finally {
      setReauthBusy(false)
    }
  }, [activeProject, sessionApiProviderId, t])
  const { isCompacting, pendingApproval, streamingTokens: rawStreamingTokens } = useActiveSession(useShallow((s) => {
    if (!parentIsStreaming) return STATIC_FOOTER
    return {
      isCompacting: s.isCompacting,
      pendingApproval: s.pendingPermissions.length > 0 || !!s.pendingQuestion || !!s.pendingPlanApproval,
      streamingTokens: s.isCompacting ? ZERO_TOKENS : s.streamingTokens,
    }
  }))
  const isStreaming = parentIsStreaming && !isCompacting
  const streamingTokens = rawStreamingTokens
  const frozenTokensRef = useRef(ZERO_TOKENS)
  if (isStreaming && (streamingTokens.input > 0 || streamingTokens.output > 0)) {
    frozenTokensRef.current = streamingTokens
  }
  // Stall means "should be streaming but isn't" — its 60s/120s thresholds are
  // calibrated for a turn that produces output. A local slash command legitimately
  // emits nothing for minutes, so leaving the heuristic on paints the footer amber
  // then red and tells the user it broke, which is worse than showing nothing.
  const stallLevel = useStallLevel(isStreaming && !runningSlashCommand)
  const pausedMsRef = useRef(0)
  const pauseStartRef = useRef(0)
  const startTimeRef = useRef(() => {
    if (message.createdAt) {
      const t = new Date(message.createdAt).getTime()
      if (t > 0) return t
    }
    return Date.now()
  })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (pendingApproval && !pauseStartRef.current) {
      pauseStartRef.current = Date.now()
    } else if (!pendingApproval && pauseStartRef.current) {
      pausedMsRef.current += Date.now() - pauseStartRef.current
      pauseStartRef.current = 0
    }
  }, [pendingApproval])

  useEffect(() => {
    if (!isStreaming) {
      if (pauseStartRef.current) {
        pausedMsRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = 0
      }
      return
    }
    const start = startTimeRef.current()
    const tick = () => {
      const activePause = pauseStartRef.current ? Date.now() - pauseStartRef.current : 0
      setElapsed(Date.now() - start - pausedMsRef.current - activePause)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isStreaming])

  const durationMs = isStreaming ? elapsed : (message.metadata?.durationMs ?? (elapsed || undefined))
  const ct = message.metadata?.consumedTokens
  const metaUsage = message.metadata?.usage
  const codexUsage = message.metadata?.codex?.usage
  // History / ACP: prefer consumedTokens; fall back to metadata.usage (main
  // runtime stores Grok/Claude turn spend there) then Codex last-turn usage.
  const tokenInput = isStreaming
    ? streamingTokens.input
    : (ct?.input
      ?? (metaUsage && (metaUsage.inputTokens > 0 || metaUsage.outputTokens > 0) ? metaUsage.inputTokens : undefined)
      ?? (codexUsage ? Math.max(0, codexUsage.lastInputTokens - codexUsage.lastCachedInputTokens) : undefined)
      ?? frozenTokensRef.current.input)
  const tokenOutput = isStreaming
    ? streamingTokens.output
    : (ct?.output
      ?? (metaUsage && (metaUsage.inputTokens > 0 || metaUsage.outputTokens > 0) ? metaUsage.outputTokens : undefined)
      ?? codexUsage?.lastOutputTokens
      ?? frozenTokensRef.current.output)
  const hasTokens = tokenInput > 0 || tokenOutput > 0

  const showDuration = durationMs && (isStreaming ? durationMs >= 1000 : durationMs >= 20000)
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    if (!copyText) return
    if (!(await tryCopy(copyText))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const showCopy = !isStreaming && !!copyText
  const showFork = !isStreaming && message.status !== 'error'
  const errorInfo = message.metadata?.errorInfo
  const showError = !isStreaming && !!errorInfo
  const terminalReason = message.metadata?.terminalReason
  // The error badge already names the failure; the bare terminal-reason chip
  // would just repeat it in developer vocabulary.
  const showTerminalReason = !isStreaming && !showError && !!terminalReason && terminalReason !== 'completed' && message.status !== 'interrupted'
  const mcpStartup = message.metadata?.codex?.mcpStartup
  const mcpServers = mcpStartup ?? []
  const hasCodexItems = (message.metadata?.codex?.items?.length ?? 0) > 0
  const hasStartingMcp = mcpServers.some((server) => server.status === 'starting')
  const showMcpStartup = isStreaming && hasStartingMcp && !hasCodexItems
  const mcpReadyCount = showMcpStartup ? mcpServers.filter((s) => s.status === 'ready').length : 0
  const failedMcp = mcpServers.filter((s) => s.status === 'failed')
  const showMcpFailure = !isStreaming && failedMcp.length > 0
  // A local slash command (/code-review) can run for minutes emitting nothing at
  // all — no text, no tools — so without this the turn is indistinguishable from
  // a hang. The footer already owns this "nothing to show yet, but work is
  // happening" slot for MCP startup. Once the turn produces anything the output
  // is itself the progress signal, so the notice retires — same rule as
  // showMcpStartup deferring to hasCodexItems. Blank text does not count: a
  // streaming turn opens with an empty block before the first token lands.
  const hasTurnOutput = message.content.some((block) =>
    block.type === 'text'
      ? block.text.trim().length > 0
      : block.type === 'thinking'
        ? block.thinking.trim().length > 0
        : true,
  )
  const showSlashCommand = isStreaming && !!runningSlashCommand && !hasTurnOutput
  if (!showDuration && !hasTokens && !showCopy && !showTerminalReason && !showError && !showMcpStartup && !showMcpFailure && !showSlashCommand) return null

  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const display = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  const stallColor = isStreaming ? getStallColor(stallLevel) : 'text-muted-foreground'

  return (
    <div className={cn('group/footer mt-2 flex items-center gap-1.5 text-xs transition-colors duration-500', stallColor, className)}>
      {showCopy && (
        <button
          onClick={handleCopy}
          className="cursor-pointer transition-colors hover:text-foreground"
        >
          {copied
            ? <Check className="size-3 text-success" />
            : <Copy className="size-3" />
          }
        </button>
      )}
      {showDuration && (
        <>
          {isStreaming
            ? <Loader2 className="size-3 animate-spin" />
            : <Clock className="size-3" />
          }
          <span>{display}</span>
        </>
      )}
      {showSlashCommand && (
        <>
          {!showDuration && <Loader2 className="size-3 animate-spin" />}
          {showDuration && <span>·</span>}
          <span>{t('chat.runningCommand', { command: runningSlashCommand!.command })}</span>
        </>
      )}
      {showMcpStartup && (
        <>
          {!showDuration && <Loader2 className="size-3 animate-spin" />}
          {showDuration && <span>·</span>}
          <span>{t('chat.codex.startingMcpServers', { ready: mcpReadyCount, total: mcpServers.length })}</span>
        </>
      )}
      {hasTokens && (
        <>
          {showDuration && <span>·</span>}
          <AnimatedToken value={tokenInput} direction="up" active={isStreaming} />
          <AnimatedToken value={tokenOutput} direction="down" active={isStreaming} />
        </>
      )}
      {showError && (
        <>
          {(showDuration || hasTokens) && <span>·</span>}
          <MessageErrorBadge info={errorInfo!} />
        </>
      )}
      {showTerminalReason && (
        <>
          {(showDuration || hasTokens) && <span>·</span>}
          <AlertTriangle className="size-3 text-warning" />
          <span className="text-warning">{formatTerminalReason(terminalReason!)}</span>
        </>
      )}
      {showMcpFailure && (() => {
        const reauthServers = failedMcp.filter((s) => s.failureReason === 'reauthenticationRequired')
        return (
          <>
            {(showDuration || hasTokens || showTerminalReason || showError) && <span>·</span>}
            <AlertTriangle className="size-3 text-warning" />
            {reauthServers.length > 0 ? (
              <button
                type="button"
                disabled={reauthBusy}
                onClick={() => handleReauth(reauthServers.map((s) => s.name))}
                className="text-warning underline-offset-2 hover:underline disabled:opacity-60"
              >
                {reauthBusy
                  ? t('chat.codex.mcpReauthenticating')
                  : t('chat.codex.mcpNeedsReauth', { name: reauthServers.map((s) => s.name).join(', ') })}
              </button>
            ) : (
              <span className="text-warning">{t('chat.codex.mcpStartupFailed', { name: failedMcp.map((s) => s.name).join(', ') })}</span>
            )}
          </>
        )
      })()}
      {showFork && (
        <ForkButton
          message={message}
          className="hidden group-hover/footer:block data-[state=open]:block"
        />
      )}
    </div>
  )
}
