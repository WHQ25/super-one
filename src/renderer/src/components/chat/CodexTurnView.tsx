import { useState } from 'react'
import type { ChatMessage as ChatMessageType, CodexThreadItem } from '../../../../shared/agent-types'
import { cn } from '@/lib/utils'
import { Streamdown } from 'streamdown'
import {
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
} from './chat-shared'
import {
  Copy,
  Check,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { ToolBlock } from './ToolBlock'

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
      className={cn('cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/copy:opacity-100', className)}
    >
      {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
    </button>
  )
}

function CopyableMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
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
      {!isStreaming && text.length > 0 && (
        <CopyButton text={text} className="absolute right-0 top-0" />
      )}
    </div>
  )
}

function StreamingAgentMessage({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  return <CopyableMarkdown text={text} isStreaming={isStreaming} />
}

function renderItem(
  item: CodexThreadItem,
  index: number,
  isStreaming: boolean,
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
        <div key={`${item.id}-${index}`} className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Thinking</span>
        </div>
      )

    case 'command_execution':
      {
        const summary = `${item.aggregatedOutput ?? ''}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim()
        return (
          <ToolBlock
            key={`${item.id}-${index}`}
            toolName="Bash"
            input={JSON.stringify({ command: item.command })}
            status={toToolStatus(item.status)}
            result={summary || undefined}
          />
        )
      }

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

  return (
    <div className="codex-turn space-y-2">
      {codex.items.map((item, idx) => renderItem(item, idx, isStreaming))}

      {!isStreaming && !hasAssistantMessage && fallbackText && (
        <div className="my-0.5">
          <CopyableMarkdown text={fallbackText} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}
