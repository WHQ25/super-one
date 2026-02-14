import type { ChatMessage as ChatMessageType, ContentBlock } from '../../../../shared/agent-types'
import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, ImageIcon, OctagonX, Folder, Brain, ChevronRight, Clock, Minimize2, ArrowUp, ArrowDown, Copy, Check } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { SubagentBlock } from './SubagentBlock'
import { CodexTurnView } from './CodexTurnView'
import { FileIcon } from '@/components/ui/FileIcon'
import { useActiveSession } from '@/stores/chat'
import {
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  formatTokens,
  useAnimatedTokens,
  getTokenAnimationDurationMs,
} from './chat-shared'

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
}

/** Group consecutive collapsible tool blocks and subagent blocks; everything else stays individual. */
function groupContent(content: ContentBlock[]): GroupResult {
  const toolNameMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  for (const block of content) {
    if (block.type === 'tool_use') {
      toolNameMap.set(block.toolUseId, block.toolName)
    } else if (block.type === 'tool_result' && block.summary) {
      toolResultMap.set(block.toolUseId, block.summary)
    }
  }

  // Collect Task tool_use ids for subagent grouping
  const taskToolUseIds = new Set<string>()
  for (const block of content) {
    if (block.type === 'tool_use' && block.toolName === 'Task') {
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
    if (block.type === 'tool_use' && block.toolName === 'Task') {
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
  return { segments, toolNameMap, toolResultMap }
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
) {
  switch (block.type) {
    case 'text':
      return (
        <CopyableText key={index} text={block.text} isStreaming={isStreaming} />
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
    case 'tool_use':
      return (
        <ToolBlock
          key={index}
          toolName={block.toolName}
          input={block.input}
          status={block.status}
          elapsedSeconds={block.elapsedSeconds}
          result={toolResultMap?.get(block.toolUseId)}
        />
      )
    case 'thinking':
      return <ThinkingBlock key={index} thinking={block.thinking} isStreaming={isStreaming} />
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

function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {isStreaming
          ? <Brain className="size-3 animate-pulse text-purple-400" />
          : <Brain className="size-3" />
        }
        <span>{isStreaming ? 'Thinking...' : 'Thinking'}</span>
        <ChevronRight className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
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

function UserTextBlock({ text }: { text: string }) {
  const { mentions, rest } = parseUserMentions(text)
  if (mentions.length === 0) return <span className="whitespace-pre-wrap">{text}</span>

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
      {rest && <span className="whitespace-pre-wrap">{rest}</span>}
    </span>
  )
}

/** Parse __compact__ marker text. Returns null if not a compact message. */
function parseCompactMarker(message: ChatMessageType): { trigger: string; preTokens: number } | null {
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

export function CompactIndicator({ trigger, preTokens }: { trigger: string; preTokens: number }) {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-xs">
      <Minimize2 className="size-3 shrink-0 text-amber-400" />
      <span className="font-medium text-amber-400">Context compacted</span>
      <span className="text-amber-400/60">{trigger === 'auto' ? 'auto' : 'manual'}</span>
      {preTokens > 0 && <span className="text-amber-400/60">· {formatCompactTokens(preTokens)} tokens</span>}
    </div>
  )
}

export function CompactingIndicator() {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-amber-400" />
      <span className="font-medium text-amber-400">Compacting context…</span>
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
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

  // Compact boundary messages — render as styled indicator
  const compactInfo = parseCompactMarker(message)
  if (compactInfo) {
    return (
      <div className="w-0 min-w-full flex justify-start">
        <div className="w-full">
          <CompactIndicator trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
        </div>
      </div>
    )
  }

  const grouped = useMemo(
    () => (isUser || isCodexMessage) ? null : groupContent(message.content),
    [isUser, isCodexMessage, message.content],
  )

  const userText = isUser
    ? message.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n')
    : ''
  return (
    <div className={cn('w-0 min-w-full flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(isUser ? 'group/copy relative mb-0 flex max-w-[85%] flex-col items-end' : 'w-full')}>
        <div
          className={cn(
            'min-w-0 text-sm',
            isUser
              ? 'rounded-xl bg-secondary text-secondary-foreground px-3 py-2'
              : 'w-full text-foreground'
          )}
        >
          {isUser
            ? <>
                {message.content.map((block, i) =>
                  block.type === 'text' ? <UserTextBlock key={i} text={block.text} /> : renderBlock(block, i, false)
                )}
              </>
          : isCodexMessage
            ? <CodexTurnView message={message} isStreaming={isStreaming} />
          : grouped!.segments.map((seg) => {
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
                return renderBlock(seg.block, seg.index, isStreaming, grouped!.toolResultMap)
              }
              const toolUseCount = seg.blocks.filter((b) => b.type === 'tool_use').length
              if (toolUseCount <= 1) {
                return seg.blocks.map((block, i) =>
                  renderBlock(block, seg.startIndex + i, isStreaming, grouped!.toolResultMap)
                )
              }
              return (
                <ToolGroup
                  key={`tg-${seg.startIndex}`}
                  blocks={seg.blocks}
                  isStreaming={isStreaming}
                />
              )
            })
        }
        {isStreaming && !isCodexMessage && message.content.length === 0 && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <OctagonX className="size-3" />
            <span>Response interrupted</span>
          </div>
        )}
        {!isUser && <DurationFooter message={message} copyText={assistantCopyText} />}
      </div>
      {isUser && userText.length > 0 && (
        <CopyButton text={userText} className="relative mt-1 opacity-0 group-hover/copy:opacity-100" />
      )}
      </div>
    </div>
  )
}

/** Single animated token value with ↑ or ↓ arrow. */
function AnimatedToken({ value, direction }: { value: number; direction: 'up' | 'down' }) {
  const display = useAnimatedTokens(value)
  const [flash, setFlash] = useState(false)
  const prev = useRef(0)

  useEffect(() => {
    if (value > prev.current && prev.current > 0) {
      setFlash(true)
      // Match flash duration to the token animation duration
      const duration = getTokenAnimationDurationMs(prev.current, value)
      const t = setTimeout(() => setFlash(false), duration)
      prev.current = value
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [value])

  if (display <= 0) return null

  const isUp = direction === 'up'
  const flashColor = isUp ? 'text-blue-400' : 'text-emerald-400'

  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums transition-colors duration-300', flash && flashColor)}>
      {isUp
        ? <ArrowUp className={cn('size-3 transition-transform duration-300', flash && 'scale-110')} />
        : <ArrowDown className={cn('size-3 transition-transform duration-300', flash && 'scale-110')} />
      }
      <span>{formatTokens(display)}</span>
    </span>
  )
}

const ZERO_TOKENS = { input: 0, output: 0 }

function DurationFooter({ message, copyText }: { message: ChatMessageType; copyText?: string }) {
  const isStreaming = message.status === 'streaming'
  // Only subscribe to streamingTokens when this message is actually streaming
  // to avoid re-rendering all completed message footers on every token update.
  const streamingTokens = useActiveSession((s) => isStreaming ? s.streamingTokens : ZERO_TOKENS)
  const startTimeRef = useRef(() => {
    if (message.createdAt) {
      const t = new Date(message.createdAt).getTime()
      if (t > 0) return t
    }
    return Date.now()
  })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isStreaming) return
    const start = startTimeRef.current()
    const tick = () => setElapsed(Date.now() - start)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isStreaming])

  const durationMs = isStreaming ? elapsed : message.metadata?.durationMs
  const ct = message.metadata?.consumedTokens
  const codexUsage = message.metadata?.codex?.usage
  const tokenInput = isStreaming ? streamingTokens.input : (ct?.input ?? codexUsage?.inputTokens ?? 0)
  const tokenOutput = isStreaming ? streamingTokens.output : (ct?.output ?? codexUsage?.outputTokens ?? 0)
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

  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
          <Clock className="size-3" />
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
