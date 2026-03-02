import type { ChatMessage as ChatMessageType, ContentBlock } from '../../../../shared/agent-types'
import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, ImageIcon, OctagonX, Folder, Brain, ChevronRight, Clock, Minimize2, ArrowUp, ArrowDown, Copy, Check, AlertTriangle } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { SubagentBlock } from './SubagentBlock'
import { CodexTurnView } from './CodexTurnView'
import { AttachmentBar } from './AttachmentBar'
import { FileIcon } from '@/components/ui/FileIcon'
import { useActiveSession } from '@/stores/chat'
import {
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  formatTokens,
} from './chat-shared'
import { RewindButton } from './RewindButton'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'

interface ChatMessageProps {
  message: ChatMessageType
}

/** Tools whose consecutive calls can be collapsed into a summary group. */
const COLLAPSIBLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])

type RenderSegment =
  | { kind: 'block'; block: ContentBlock; index: number }
  | { kind: 'tools'; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'subagent'; taskBlock: ContentBlock & { type: 'tool_use' }; childBlocks: ContentBlock[]; resultBlock?: ContentBlock; startIndex: number }

interface GroupResult {
  segments: RenderSegment[]
  toolNameMap: Map<string, string>
  toolResultMap: Map<string, string>
  timedOutToolIds: Set<string>
  outputPathMap: Map<string, string>
}

/** Group consecutive collapsible tool blocks and subagent blocks; everything else stays individual. */
function groupContent(content: ContentBlock[]): GroupResult {
  const toolNameMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  const timedOutToolIds = new Set<string>()
  const outputPathMap = new Map<string, string>()
  for (const block of content) {
    if (block.type === 'tool_use') {
      toolNameMap.set(block.toolUseId, block.toolName)
    } else if (block.type === 'tool_result') {
      if (block.summary) toolResultMap.set(block.toolUseId, block.summary)
      if (block.isTimedOut) timedOutToolIds.add(block.toolUseId)
      if (block.outputPath) outputPathMap.set(block.toolUseId, block.outputPath)
    }
  }

  // Collect Task tool_use ids for subagent grouping
  const taskToolUseIds = new Set<string>()
  for (const block of content) {
    if (block.type === 'tool_use' && block.toolName === 'Agent') {
      taskToolUseIds.add(block.toolUseId)
    }
  }

  const segments: RenderSegment[] = []
  let group: ContentBlock[] = []
  let groupStart = 0

  // Active subagent collectors: taskToolUseId → segment reference
  const activeSubagents = new Map<string, RenderSegment & { kind: 'subagent' }>()

  const flush = () => {
    if (group.length === 0) return
    segments.push({ kind: 'tools', blocks: group, startIndex: groupStart })
    group = []
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

    // Normal grouping for collapsible tools
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
  return { segments, toolNameMap, toolResultMap, timedOutToolIds, outputPathMap }
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className={cn('cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/copy:opacity-100', className ?? 'absolute right-0 top-0')}
    >
      {copied
        ? <Check className="size-3 text-green-400" />
        : <Copy className="size-3" />
      }
    </button>
  )
}

function CopyableText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="group/copy relative">
      <Streamdown
        className="chat-md"
        plugins={streamdownPlugins}
        components={streamdownComponents}
        controls={streamdownControls}
        linkSafety={streamdownLinkSafety}
        isAnimating={isStreaming}
      >
        {text}
      </Streamdown>
      {!isStreaming && text.length > 0 && <CopyButton text={text} />}
    </div>
  )
}

function renderBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap?: Map<string, string>,
  timedOutToolIds?: Set<string>,
  outputPathMap?: Map<string, string>,
  nextBlockType?: string,
  prevBlockType?: string,
) {
  switch (block.type) {
    case 'text':
      return (
        <div key={index} className={prevBlockType === 'thinking' ? 'mt-1 after-thinking' : undefined}>
          <CopyableText text={block.text} isStreaming={isStreaming} />
        </div>
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
    case 'tool_use':
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
          resultOutputPath={outputPathMap?.get(block.toolUseId)}
        />
      )
    case 'thinking':
      return <ThinkingBlock key={index} thinking={block.thinking} isStreaming={isStreaming} blockDone={!isStreaming || !!nextBlockType} />
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

function ThinkingBlock({ thinking, isStreaming, blockDone }: { thinking: string; isStreaming: boolean; blockDone: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(!blockDone ? Date.now() : 0)
  const [expanded, setExpanded] = useState(!blockDone)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (blockDone || !startRef.current) return
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [blockDone])

  useEffect(() => {
    if (blockDone) {
      if (startRef.current) setElapsed(Math.round((Date.now() - startRef.current) / 1000))
      setExpanded(false)
    }
  }, [blockDone])

  const rafRef = useRef(0)
  useEffect(() => {
    if (!expanded) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [thinking, expanded])

  const active = !blockDone
  const label = active
    ? (elapsed >= 1 ? `Thinking for ${elapsed}s...` : 'Thinking...')
    : (startRef.current > 0 && elapsed >= 1 ? `Thought for ${elapsed}s` : 'Thought')

  return (
    <div className="thinking-node mt-3 mb-2">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {active
          ? <Brain className="size-3 animate-pulse" />
          : <Brain className="size-3" />
        }
        <span>{label}</span>
        <ChevronRight className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          className="thinking-content mt-1 max-h-32 overflow-y-auto pl-2 text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap"
        >
          {thinking}
        </div>
      )}
    </div>
  )
}

/** Extract leading @mention tokens from user text. */
function parseUserMentions(text: string) {
  const mentions: { value: string; kind: 'file' | 'directory' | 'agent' }[] = []
  let rest = text
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const match = rest.match(/^@(\S+)\s*/)
    if (!match) break
    const value = match[1]
    const kind = value.endsWith('/')
      ? 'directory' as const
      : value.includes('/') || value.includes('.')
        ? 'file' as const
        : 'agent' as const
    mentions.push({ value, kind })
    rest = rest.slice(match[0].length)
  }
  return { mentions, rest }
}

export function UserTextBlock({ text }: { text: string }) {
  const { mentions, rest } = parseUserMentions(text)
  if (mentions.length === 0) return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</span>

  const displayName = (v: string) => v.replace(/\/$/, '').split('/').pop() || v

  return (
    <span>
      {mentions.length > 0 && (
        <span className="mb-1 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span
              key={m.value}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                m.kind === 'agent'
                  ? 'border-purple-400/40 bg-purple-400/15 text-purple-300'
                  : 'border-white/15 bg-white/10 text-white/90'
              )}
            >
              {m.kind === 'agent' ? (
                <span className="font-medium">@{displayName(m.value)}</span>
              ) : m.kind === 'directory' ? (
                <>
                  <Folder className="size-3.5 shrink-0 text-blue-400" />
                  <span>{displayName(m.value)}</span>
                </>
              ) : (
                <>
                  <FileIcon name={displayName(m.value)} size={14} />
                  <span>{displayName(m.value)}</span>
                </>
              )}
            </span>
          ))}
        </span>
      )}
      {rest && <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{rest}</span>}
    </span>
  )
}

export function parseCompactMarker(message: ChatMessageType): { trigger: string; preTokens: number } | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const match = firstBlock.text.match(/^__compact__:(manual|auto):(\d+)$/)
  if (!match) return null
  return { trigger: match[1], preTokens: parseInt(match[2], 10) }
}

/** Format token count for compact display. */
function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

export function CompactIndicator({
  trigger,
  preTokens,
  expanded,
  onToggle,
}: {
  trigger: string
  preTokens: number
  expanded?: boolean
  onToggle?: () => void
}) {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-violet-500/10 px-2 py-1.5 text-xs">
      <Minimize2 className="size-3 shrink-0 text-violet-400" />
      <span className="font-medium text-violet-400">Conversation compacted</span>
      <span className="text-violet-400/60">{trigger === 'auto' ? 'auto' : 'manual'}</span>
      {preTokens > 0 && <span className="text-violet-400/60">· {formatCompactTokens(preTokens)} tokens</span>}
      {onToggle && (
        <button onClick={onToggle} className="ml-auto flex items-center gap-0.5 text-violet-400/60 transition-colors hover:text-violet-400">
          {expanded ? <ChevronRight className="size-3 -rotate-90" /> : <ChevronRight className="size-3 rotate-90" />}
          <span>{expanded ? 'Hide history' : 'Show history'}</span>
        </button>
      )}
    </div>
  )
}

export function CompactingIndicator() {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-amber-400" />
      <span className="font-medium text-amber-400">Compacting conversation…</span>
    </div>
  )
}

function formatResetTime(resetsAt?: number): string | null {
  if (!resetsAt) return null
  const now = Date.now() / 1000
  const diff = resetsAt - now
  if (diff <= 0) return null
  if (diff < 60) return 'less than 1 min'
  if (diff < 3600) return `${Math.ceil(diff / 60)} min`
  return `${Math.round(diff / 3600 * 10) / 10} hrs`
}

export function RateLimitIndicator({ info }: { info: { status: 'allowed_warning' | 'rejected'; resetsAt?: number; rateLimitType?: string; utilization?: number } }) {
  const isRejected = info.status === 'rejected'
  const resetLabel = formatResetTime(info.resetsAt)
  const pct = info.utilization != null ? Math.round(info.utilization * 100) : null

  return (
    <div className={cn(
      'my-0.5 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs',
      isRejected ? 'bg-red-500/10' : 'bg-amber-500/10',
    )}>
      {isRejected
        ? <OctagonX className="size-3 shrink-0 text-red-400" />
        : <AlertTriangle className="size-3 shrink-0 text-amber-400" />
      }
      <span className={cn('font-medium', isRejected ? 'text-red-400' : 'text-amber-400')}>
        {isRejected ? 'Rate limited' : 'Approaching rate limit'}
      </span>
      {pct != null && !isRejected && (
        <span className="text-amber-400/60">{pct}% used</span>
      )}
      {resetLabel && (
        <span className={isRejected ? 'text-red-400/60' : 'text-amber-400/60'}>· resets in {resetLabel}</span>
      )}
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const sessionStatus = useActiveSession((s) => s.status)
  const isLastAssistant = useActiveSession(
    (s) => s.messages.findLast((m) => m.role === 'assistant')?.id === message.id
  )
  const isStreaming = message.status === 'streaming' && sessionStatus === 'streaming' && isLastAssistant
  const isCodexMessage = !isUser && message.providerId === 'codex'
  const assistantCopyText = !isUser
    ? (() => {
        if (isCodexMessage) {
          const codexText = message.metadata?.codex?.items
            ?.filter((item) => item.type === 'agent_message')
            .map((item) => item.text)
            .join('\n\n')
            .trim()
          if (codexText) return codexText
        }
        return message.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('\n')
      })()
    : undefined

  const grouped = useMemo(
    () => (isUser || isCodexMessage) ? null : groupContent(message.content),
    [isUser, isCodexMessage, message.content],
  )

  const userText = isUser
    ? message.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n')
    : ''
  return (
    <div className={cn('w-0 min-w-full flex', isUser ? 'justify-end' : 'mb-2 justify-start')}>
      <div className={cn(isUser ? 'group/copy relative mb-0 flex max-w-[85%] flex-col items-end' : 'w-full')}>
        <div
          className={cn(
            'min-w-0 text-sm',
            isUser
              ? 'rounded-xl bg-secondary px-3 py-2 text-secondary-foreground break-words [overflow-wrap:anywhere]'
              : 'assistant-reply w-full text-foreground'
          )}
        >
          {isUser
            ? <>
                {message.attachments && message.attachments.length > 0 && (
                  <AttachmentBar attachments={message.attachments} />
                )}
                {message.content.map((block, i) => {
                  if (message.attachments?.length && (block.type === 'image' || block.type === 'document')) return null
                  return block.type === 'text' ? <UserTextBlock key={i} text={block.text} /> : renderBlock(block, i, false)
                })}
              </>
          : isCodexMessage
            ? <CodexTurnView message={message} isStreaming={isStreaming} />
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
              if (seg.kind === 'block') {
                const nextSeg = segs[segIdx + 1]
                const prevSeg = segs[segIdx - 1]
                const nextType = nextSeg?.kind === 'block' ? nextSeg.block.type : nextSeg?.kind === 'tools' ? nextSeg.blocks[0]?.type : nextSeg?.kind === 'subagent' ? 'tool_use' : undefined
                const prevType = prevSeg?.kind === 'block' ? prevSeg.block.type : undefined
                return renderBlock(seg.block, seg.index, isStreaming, grouped!.toolResultMap, grouped!.timedOutToolIds, grouped!.outputPathMap, nextType, prevType)
              }
              const toolUseCount = seg.blocks.filter((b) => b.type === 'tool_use').length
              if (toolUseCount <= 1) {
                return seg.blocks.map((block, i) =>
                  renderBlock(block, seg.startIndex + i, isStreaming, grouped!.toolResultMap, grouped!.timedOutToolIds, grouped!.outputPathMap, seg.blocks[i + 1]?.type, seg.blocks[i - 1]?.type)
                )
              }
              return (
                <ToolGroup
                  key={`tg-${seg.startIndex}`}
                  blocks={seg.blocks}
                />
              )
            })
        }
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <OctagonX className="size-3" />
            <span>Response interrupted</span>
          </div>
        )}
        {!isUser && <DurationFooter message={message} copyText={assistantCopyText} parentIsStreaming={isStreaming} />}
      </div>
      {isUser && (
        <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
          {message.checkpointId && <RewindButton checkpointId={message.checkpointId} rewound={message.rewound} className="opacity-100" />}
          {userText.length > 0 && <CopyButton text={userText} className="opacity-100" />}
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
  const flashColor = isUp ? 'text-blue-400' : 'text-emerald-400'

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

const ZERO_TOKENS = { input: 0, output: 0 }

function DurationFooter({ message, copyText, parentIsStreaming }: { message: ChatMessageType; copyText?: string; parentIsStreaming: boolean }) {
  const isCompacting = useActiveSession((s) => s.isCompacting)
  const isStreaming = parentIsStreaming && !isCompacting
  const streamingTokens = useActiveSession((s) => isStreaming ? s.streamingTokens : ZERO_TOKENS)
  const frozenTokensRef = useRef(ZERO_TOKENS)
  if (isStreaming && (streamingTokens.input > 0 || streamingTokens.output > 0)) {
    frozenTokensRef.current = streamingTokens
  }
  const pendingApproval = useActiveSession((s) =>
    isStreaming && (!!s.pendingPermission || !!s.pendingQuestion || !!s.pendingPlanApproval),
  )
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
  const tokenInput = isStreaming ? streamingTokens.input : (ct?.input ?? codexUsage?.inputTokens ?? frozenTokensRef.current.input)
  const tokenOutput = isStreaming ? streamingTokens.output : (ct?.output ?? codexUsage?.outputTokens ?? frozenTokensRef.current.output)
  const hasTokens = tokenInput > 0 || tokenOutput > 0

  const showDuration = durationMs && (isStreaming ? durationMs >= 1000 : durationMs >= 20000)
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!copyText) return
    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const showCopy = !isStreaming && !!copyText
  if (!showDuration && !hasTokens && !showCopy) return null

  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const display = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  const stallColor = isStreaming ? getStallColor(stallLevel) : 'text-muted-foreground'

  return (
    <div className={cn('mt-2 flex items-center gap-1.5 text-[11px] transition-colors duration-500', stallColor)}>
      {showCopy && (
        <button
          onClick={handleCopy}
          className="cursor-pointer transition-colors hover:text-foreground"
        >
          {copied
            ? <Check className="size-3 text-green-400" />
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
      {hasTokens && (
        <>
          {showDuration && <span>·</span>}
          <AnimatedToken value={tokenInput} direction="up" />
          <AnimatedToken value={tokenOutput} direction="down" />
        </>
      )}
    </div>
  )
}
