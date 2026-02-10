import type { ChatMessage as ChatMessageType, ContentBlock } from '../../../../shared/agent-types'
import { cn } from '@/lib/utils'
import { Loader2, ImageIcon, OctagonX, Folder } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { createStreamdownCodeComponent } from './CodeBlock'
import { FileIcon } from '@/components/ui/FileIcon'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownControls = { table: false }

const streamdownComponents = {
  code: createStreamdownCodeComponent(codePlugin),
}

interface ChatMessageProps {
  message: ChatMessageType
}

/** Tools whose consecutive calls can be collapsed into a summary group. */
const COLLAPSIBLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])

type RenderSegment =
  | { kind: 'block'; block: ContentBlock; index: number }
  | { kind: 'tools'; blocks: ContentBlock[]; startIndex: number }

interface GroupResult {
  segments: RenderSegment[]
  toolNameMap: Map<string, string>
  toolResultMap: Map<string, string>
}

/** Group consecutive collapsible tool blocks; everything else stays individual. */
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

  const segments: RenderSegment[] = []
  let group: ContentBlock[] = []
  let groupStart = 0

  const flush = () => {
    if (group.length === 0) return
    segments.push({ kind: 'tools', blocks: group, startIndex: groupStart })
    group = []
  }

  for (let i = 0; i < content.length; i++) {
    const block = content[i]

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

function renderBlock(
  block: ContentBlock,
  index: number,
  isStreaming: boolean,
  toolResultMap?: Map<string, string>,
) {
  switch (block.type) {
    case 'text':
      return (
        <Streamdown
          key={index}
          className="chat-md"
          plugins={streamdownPlugins}
          components={streamdownComponents}
          controls={streamdownControls}
          isAnimating={isStreaming}
        >
          {block.text}
        </Streamdown>
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

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'

  const grouped = isUser ? null : groupContent(message.content)

  return (
    <div className={cn('w-0 min-w-full flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 text-sm',
          isUser
            ? 'max-w-[85%] rounded-xl bg-[#007AFF] text-white dark:bg-[#3A3A3C] dark:text-foreground px-3 py-2'
            : 'max-w-full text-foreground'
        )}
      >
        {isUser
          ? message.content.map((block, i) =>
              block.type === 'text' ? <UserTextBlock key={i} text={block.text} /> : renderBlock(block, i, false)
            )
          : grouped!.segments.map((seg) => {
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
        {isStreaming && message.content.length === 0 && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <OctagonX className="size-3" />
            <span>Response interrupted</span>
          </div>
        )}
      </div>
    </div>
  )
}
