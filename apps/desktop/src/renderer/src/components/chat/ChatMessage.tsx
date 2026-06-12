import type { ChatMessage as ChatMessageType, ContentBlock, AgentStatus } from '@superone/shared/agent-types'
import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Loader2, ImageIcon, OctagonX, Folder, ChevronRight, Clock, Minimize2, ArrowUp, ArrowDown, Copy, Check, AlertTriangle, X, Shuffle } from 'lucide-react'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { AppToolGroup } from './AppToolGroup'
import { parseToolInput, parseMcpToolName } from './tool-display'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { SubagentBlock } from './SubagentBlock'
import { WorkflowBlock } from './WorkflowBlock'
import { CodexTurnView } from './CodexTurnView'
import { AttachmentBar } from './AttachmentBar'
import { UserSelectionChip } from './UserSelectionChip'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { FileText } from 'lucide-react'
import { PasteChipPreview } from './PasteChipPreview'
import { PASTE_CHIP_LINE_THRESHOLD, PASTE_CHIP_CHAR_THRESHOLD } from './paste-chip-node'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { getAssistantCopyText } from './chat-message/getAssistantCopyText'
import {
  formatTokens,
  resolveMarkdownMedia,
} from './chat-shared'
import { RewindButton } from './RewindButton'
import { ForkButton } from './ForkButton'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { tryCopy } from '@/lib/clipboard'
import { CopyableMarkdown } from './CopyableMarkdown'
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
function groupContent(content: ContentBlock[], apps: MiniAppEntry[]): GroupResult {
  const toolNameMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  const timedOutToolIds = new Set<string>()
  const errorToolIds = new Set<string>()
  const outputPathMap = new Map<string, string>()
  const taskToolUseIds = new Set<string>()
  for (const block of content) {
    if (block.type === 'tool_use') {
      toolNameMap.set(block.toolUseId, block.toolName)
      if (block.toolName === 'Agent') taskToolUseIds.add(block.toolUseId)
    } else if (block.type === 'tool_result') {
      if (block.summary) toolResultMap.set(block.toolUseId, block.summary)
      if (block.isTimedOut) timedOutToolIds.add(block.toolUseId)
      if (block.isError) errorToolIds.add(block.toolUseId)
      if (block.outputPath) outputPathMap.set(block.toolUseId, block.outputPath)
    }
  }

  // Build a set of tool_use IDs that belong to groupable app tools
  const appToolIdToAppId = new Map<string, string>()
  const slugToApp = new Map(apps.flatMap((a) => {
    const slug = a.manifest.toolSlug ?? a.id
    return slug ? [[slug, a] as const] : []
  }))
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const mcp = parseMcpToolName(block.toolName)
    if (!mcp || mcp.serverName !== 'superone') continue
    const appToolMatch = mcp.mcpToolName.match(/^(.+?)__(.+)$/)
    if (!appToolMatch) continue
    const [, slug, toolNamePart] = appToolMatch
    const app = slugToApp.get(slug)
    if (!app) continue
    const toolDef = app.manifest.tools?.find((t) => t.name === toolNamePart)
    // Standalone tools own their entire chat block (an iframe) — never group them,
    // grouping would defeat the purpose of inline custom UI per call.
    if (toolDef?.standalone) continue
    if (toolDef?.groupable) appToolIdToAppId.set(block.toolUseId, app.id)
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

    // Check if this block belongs to a subagent
    const parentId = 'parentToolUseId' in block ? block.parentToolUseId : null
    if (parentId && activeSubagents.has(parentId)) {
      activeSubagents.get(parentId)!.childBlocks.push(block)
      continue
    }

    // Check if this is a Task tool_result (closes a subagent)
    if (block.type === 'tool_result' && taskToolUseIds.has(block.toolUseId) && activeSubagents.has(block.toolUseId)) {
      activeSubagents.get(block.toolUseId)!.resultBlock = block
      activeSubagents.delete(block.toolUseId)
      continue
    }

    // Start a new subagent segment for Task tool_use
    if (block.type === 'tool_use' && block.toolName === 'Agent') {
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
      continue
    }

    // Workflow tool_result closes its workflow segment
    if (block.type === 'tool_result' && activeWorkflows.has(block.toolUseId)) {
      activeWorkflows.get(block.toolUseId)!.resultBlock = block
      activeWorkflows.delete(block.toolUseId)
      continue
    }

    // Start a new workflow segment for Workflow tool_use
    if (block.type === 'tool_use' && block.toolName === 'Workflow') {
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
    } else {
      flush()
      segments.push({ kind: 'block', block, index: i })
    }
  }
  flush()
  flushAppGroup()
  return { segments, toolNameMap, toolResultMap, timedOutToolIds, errorToolIds, outputPathMap }
}

function CopyButton({ copied, onClick, className }: { copied: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/copy:opacity-100', className ?? 'absolute right-0 top-0')}
    >
      {copied
        ? <Check className="size-3 text-success" />
        : <Copy className="size-3" />
      }
    </button>
  )
}

function useCopyText() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async (text: string) => {
    if (window.getSelection()?.toString()) return
    if (!(await tryCopy(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])
  return { copied, copy }
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
    case 'text': {
      const text = projectPath ? resolveMarkdownMedia(block.text, projectPath) : block.text
      return (
        <div key={index} className={prevBlockType === 'thinking' ? 'mt-1 after-thinking' : undefined}>
          <CopyableMarkdown text={text} isStreaming={isStreaming} components={fileLinkComponents} />
        </div>
      )
    }
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
        <div key={index} className="my-0.5 overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
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
  if (forcePlain) return <span className="whitespace-pre-wrap">{rest}</span>
  const lineCount = rest.split('\n').length
  if (lineCount >= PASTE_CHIP_LINE_THRESHOLD || rest.length >= PASTE_CHIP_CHAR_THRESHOLD) return <LongTextChip text={rest} />
  return <span className="whitespace-pre-wrap">{rest}</span>
}

function MentionInlineChip({ kind, value, displayName }: { kind: UserMentionKind; value: string; displayName?: string }) {
  const display = kind === 'miniapp'
    ? (displayName ?? value)
    : (value.replace(/\/$/, '').split('/').pop() || value)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs align-middle whitespace-nowrap',
        kind === 'agent'
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-foreground/15 bg-foreground/10 text-foreground/90'
      )}
    >
      {kind === 'agent' ? (
        <span className="font-medium">@{display}</span>
      ) : kind === 'directory' ? (
        <>
          <Folder className="size-3.5 shrink-0 text-primary" />
          <span>{display}</span>
        </>
      ) : kind === 'miniapp' ? (
        <>
          <MiniAppIcon appId={value} className="size-3.5 shrink-0" />
          <span>{display}</span>
        </>
      ) : (
        <>
          <FileIcon name={display} size={14} />
          <span>{display}</span>
        </>
      )}
    </span>
  )
}

export function UserTextBlock({ text, isPaste }: { text: string; isPaste?: boolean }) {
  if (isPaste === true) return <LongTextChip text={text} />
  const segments = parseUserMentions(text)
  if (segments.length === 0) return null
  return (
    <span>
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

/** Format token count for compact display. */
function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/** Format a millisecond duration as "98s" / "1m 38s". */
function formatCompactDuration(ms: number): string {
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
  const pillClass = 'inline-flex items-center whitespace-nowrap rounded bg-primary/15 px-1.5 py-px text-[11px] text-primary/80'
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

export function ApiRetryIndicator({ info }: { info: { attempt: number; maxRetries: number; delayMs: number } }) {
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
      <span className="font-medium text-warning">
        Retrying API request ({info.attempt}/{info.maxRetries})… {secs > 0 && <>{secs}s</>}
      </span>
    </div>
  )
}

const MODEL_FALLBACK_REASONS: Record<string, string> = {
  overloaded: 'primary model overloaded',
  server_error: 'a server error',
  model_not_found: 'the model being unavailable',
  permission_denied: 'access being denied',
  last_resort: 'all preferred models being unavailable',
  refusal: 'the primary model declining',
}

function shortModelName(model?: string): string | null {
  if (!model) return null
  return model.replace(/^(claude|anthropic|us\.anthropic)[./-]/, '').replace(/\[1m\]$/, '')
}

export function ModelFallbackIndicator({ info }: { info: { trigger: string; fromModel?: string; toModel?: string } }) {
  const reason = MODEL_FALLBACK_REASONS[info.trigger] ?? info.trigger
  const to = shortModelName(info.toModel)
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs">
      <Shuffle className="size-3 shrink-0 text-warning" />
      <span className="font-medium text-warning">
        {to ? <>Switched to {to}</> : <>Switched model</>} due to {reason}
      </span>
    </div>
  )
}

function formatResetTime(resetsAt?: number): string | null {
  if (!resetsAt) return null
  const date = new Date(resetsAt * 1000)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date)
}

export function RateLimitIndicator({
  info,
  onDismiss,
}: {
  info: { status: 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number }
  onDismiss?: () => void
}) {
  const isRejected = info.status === 'rejected'
  const resetLabel = formatResetTime(info.resetsAt)
  const pct = info.utilization != null ? Math.round(info.utilization * 100) : null

  return (
    <div className={cn(
      'my-0.5 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs',
      isRejected ? 'bg-error/10' : 'bg-warning/10',
    )}>
      {isRejected
        ? <OctagonX className="size-3 shrink-0 text-error" />
        : <AlertTriangle className="size-3 shrink-0 text-warning" />
      }
      <span className={cn('font-medium', isRejected ? 'text-error' : 'text-warning')}>
        {isRejected ? 'Rate limited' : 'Approaching rate limit'}
      </span>
      {pct != null && !isRejected && (
        <span className="text-warning/60">{pct}% used</span>
      )}
      {resetLabel && (
        <span className={isRejected ? 'text-error/60' : 'text-warning/60'}>· resets at {resetLabel}</span>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss rate limit notice"
          className={cn(
            'ml-auto cursor-pointer rounded p-0.5 transition-colors',
            isRejected ? 'text-error/60 hover:text-error' : 'text-warning/60 hover:text-warning',
          )}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({ message, sessionStatus, isLastAssistant, hideUserActions }: ChatMessageProps) {
  const projectPath = useChatStore((s) => s.activeProject)
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming' && sessionStatus === 'streaming' && isLastAssistant
  const isCodexMessage = !isUser && message.providerId === 'codex'
  const assistantCopyText = useMemo(
    () => getAssistantCopyText(message),
    [message],
  )

  const apps = useMiniAppStore((s) => s.apps)
  const grouped = useMemo(
    () => (isUser || isCodexMessage) ? null : groupContent(message.content, apps),
    [isUser, isCodexMessage, message.content, apps],
  )

  const userText = useMemo(
    () => (isUser
      ? replaceMiniAppTagsWithMention(message.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n'))
      : ''),
    [isUser, message.content],
  )
  const { copied: userCopied, copy: copyUserText } = useCopyText()
  return (
    <div className={cn('w-0 min-w-full flex', isUser ? 'justify-end' : 'mb-2 justify-start')}>
      <div className={cn(isUser ? 'group/copy relative mb-0 flex min-w-0 max-w-[90%] flex-col items-end' : 'w-full')}>
        <div
          className={cn(
            'min-w-0 text-sm',
            isUser
              ? 'max-w-full overflow-hidden rounded-xl bg-muted/80 px-3 py-2 text-foreground break-all'
              : 'assistant-reply w-full text-foreground'
          )}
        >
          {isUser
            ? <>
                {message.userSelections && message.userSelections.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    <UserSelectionChip selections={message.userSelections} readOnly />
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <AttachmentBar attachments={message.attachments} />
                )}
                {message.content.map((block, i) => {
                  if (message.attachments?.length && (block.type === 'image' || block.type === 'document')) return null
                  return block.type === 'text' ? <UserTextBlock key={i} text={block.text} isPaste={block.isPaste} /> : renderBlock(block, i, false)
                })}
              </>
          : isCodexMessage
            ? <CodexTurnView message={message} isStreaming={isStreaming} isLastAssistant={isLastAssistant} />
            : grouped!.segments.map((seg, segIdx, segs) => {
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
                    renderBlock(block, seg.startIndex + i, isStreaming, grouped!.toolResultMap, grouped!.timedOutToolIds, grouped!.errorToolIds, grouped!.outputPathMap, seg.blocks[i + 1]?.type, seg.blocks[i - 1]?.type, projectPath)
                  )
                }
                return (
                  <AppToolGroup
                    key={`atg-${seg.startIndex}`}
                    appId={seg.appId}
                    blocks={seg.blocks}
                    sealed={!isStreaming || segIdx < segs.length - 1}
                  />
                )
              }
              if (seg.kind === 'block') {
                const nextSeg = segs[segIdx + 1]
                const prevSeg = segs[segIdx - 1]
                const nextType = nextSeg?.kind === 'block' ? nextSeg.block.type : nextSeg?.kind === 'tools' ? nextSeg.blocks[0]?.type : nextSeg?.kind === 'subagent' ? 'tool_use' : undefined
                const prevType = prevSeg?.kind === 'block' ? prevSeg.block.type : undefined
                return renderBlock(seg.block, seg.index, isStreaming, grouped!.toolResultMap, grouped!.timedOutToolIds, grouped!.errorToolIds, grouped!.outputPathMap, nextType, prevType, projectPath)
              }
              const toolUseCount = seg.blocks.filter((b) => b.type === 'tool_use').length
              if (toolUseCount <= 1) {
                return seg.blocks.map((block, i) =>
                  renderBlock(block, seg.startIndex + i, isStreaming, grouped!.toolResultMap, grouped!.timedOutToolIds, grouped!.errorToolIds, grouped!.outputPathMap, seg.blocks[i + 1]?.type, seg.blocks[i - 1]?.type, projectPath)
                )
              }
              return (
                <ToolGroup
                  key={`tg-${seg.startIndex}`}
                  blocks={seg.blocks}
                  sealed={!isStreaming || segIdx < segs.length - 1}
                />
              )
            })
        }
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <OctagonX className="size-3" />
            <span>Interrupted · What should I do instead?</span>
          </div>
        )}
        {!isUser && <DurationFooter message={message} copyText={assistantCopyText} parentIsStreaming={isStreaming} />}
      </div>
      {isUser && message.contexts && message.contexts.length > 0 && (
        <div className="mt-1.5">
          <MessageContextChips contexts={message.contexts} />
        </div>
      )}
      {isUser && !hideUserActions && (
        <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
          {message.checkpointId && <RewindButton checkpointId={message.checkpointId} rewound={message.rewound} className="opacity-100" />}
          {userText.length > 0 && <CopyButton copied={userCopied} onClick={() => copyUserText(userText)} className="opacity-100" />}
        </div>
      )}
      </div>
    </div>
  )
})

/** Token value with ↑ or ↓ arrow. Highlights while value is actively changing, fades after 1s of inactivity. */
function AnimatedToken({ value, direction }: { value: number; direction: 'up' | 'down' }) {
  const [flash, setFlash] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prevRef = useRef(0)

  useEffect(() => {
    if (value > prevRef.current && prevRef.current > 0) {
      setFlash(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlash(false), 1000)
    }
    prevRef.current = value
    return () => clearTimeout(timerRef.current)
  }, [value])

  if (value <= 0) return null

  const isUp = direction === 'up'
  const flashColor = isUp ? 'text-primary' : 'text-emerald-400'

  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums transition-colors duration-500', flash && flashColor)}>
      {isUp
        ? <ArrowUp className={cn('size-3 transition-transform duration-300', flash && 'scale-110')} />
        : <ArrowDown className={cn('size-3 transition-transform duration-300', flash && 'scale-110')} />
      }
      <span>{formatTokens(value)}</span>
    </span>
  )
}

const TERMINAL_REASON_LABELS: Record<string, string> = {
  max_turns: 'Max turns',
  aborted_tools: 'Aborted',
  blocking_limit: 'Blocked',
}
function formatTerminalReason(reason: string): string {
  return TERMINAL_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

const ZERO_TOKENS = { input: 0, output: 0 }
const STATIC_FOOTER = { isCompacting: false, pendingApproval: false, streamingTokens: ZERO_TOKENS }

function DurationFooter({ message, copyText, parentIsStreaming }: { message: ChatMessageType; copyText?: string; parentIsStreaming: boolean }) {
  const { t } = useTranslation()
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
  const stallLevel = useStallLevel(isStreaming)
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
  const codexUsage = message.metadata?.codex?.usage
  const tokenInput = isStreaming
    ? streamingTokens.input
    : (ct?.input ?? (codexUsage ? Math.max(0, codexUsage.lastInputTokens - codexUsage.lastCachedInputTokens) : undefined) ?? frozenTokensRef.current.input)
  const tokenOutput = isStreaming
    ? streamingTokens.output
    : (ct?.output ?? codexUsage?.lastOutputTokens ?? frozenTokensRef.current.output)
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
  const terminalReason = message.metadata?.terminalReason
  const showTerminalReason = !isStreaming && !!terminalReason && terminalReason !== 'completed' && message.status !== 'interrupted'
  const mcpStartup = message.metadata?.codex?.mcpStartup
  const hasCodexItems = (message.metadata?.codex?.items?.length ?? 0) > 0
  const showMcpStartup = isStreaming && !!mcpStartup && mcpStartup.length > 0 && !hasCodexItems
  const mcpReadyCount = showMcpStartup ? mcpStartup.filter((s) => s.status === 'ready').length : 0
  if (!showDuration && !hasTokens && !showCopy && !showTerminalReason && !showMcpStartup) return null

  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const display = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  const stallColor = isStreaming ? getStallColor(stallLevel) : 'text-muted-foreground'

  return (
    <div className={cn('group/footer mt-2 flex items-center gap-1.5 text-[11px] transition-colors duration-500', stallColor)}>
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
      {showMcpStartup && (
        <>
          {!showDuration && <Loader2 className="size-3 animate-spin" />}
          {showDuration && <span>·</span>}
          <span>{t('chat.codex.startingMcpServers', { ready: mcpReadyCount, total: mcpStartup.length })}</span>
        </>
      )}
      {hasTokens && (
        <>
          {showDuration && <span>·</span>}
          <AnimatedToken value={tokenInput} direction="up" />
          <AnimatedToken value={tokenOutput} direction="down" />
        </>
      )}
      {showTerminalReason && (
        <>
          {(showDuration || hasTokens) && <span>·</span>}
          <AlertTriangle className="size-3 text-warning" />
          <span className="text-warning">{formatTerminalReason(terminalReason!)}</span>
        </>
      )}
      {showFork && (
        <ForkButton
          message={message}
          className="hidden group-hover/footer:block data-[state=open]:block"
        />
      )}
    </div>
  )
}
