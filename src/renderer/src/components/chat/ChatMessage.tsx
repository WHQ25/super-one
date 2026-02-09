import type { ChatMessage as ChatMessageType, ContentBlock } from '../../../../shared/agent-types'
import { cn } from '@/lib/utils'
import { Loader2, ImageIcon, OctagonX } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '@streamdown/code'
import { ToolBlock } from './ToolBlock'
import { CodeBlock, InlineCode } from './CodeBlock'

const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })
const streamdownPlugins = { code: codePlugin }
const streamdownComponents = {
  pre: CodeBlock,
  code: ({ children, className, ...props }: React.ComponentProps<'code'>) => {
    if (!className) return <InlineCode {...props}>{children}</InlineCode>
    return <code {...props} className={className}>{children}</code>
  },
}

interface ChatMessageProps {
  message: ChatMessageType
}

function renderBlock(block: ContentBlock, index: number, isStreaming: boolean) {
  switch (block.type) {
    case 'text':
      return (
        <Streamdown key={index} plugins={streamdownPlugins} components={streamdownComponents} isAnimating={isStreaming}>
          {block.text}
        </Streamdown>
      )
    case 'image':
      return (
        <div
          key={index}
          className="my-1 flex items-center gap-1.5 rounded bg-neutral-700/50 px-2 py-1 text-xs text-neutral-300"
        >
          <ImageIcon className="size-3 shrink-0" />
          <span className="truncate">{block.name}</span>
        </div>
      )
    case 'tool_use':
      return <ToolBlock key={index} toolName={block.toolName} input={block.input} status={block.status} elapsedSeconds={block.elapsedSeconds} />
    case 'tool_result':
      return (
        <div
          key={index}
          className="my-1 rounded bg-neutral-700/50 px-2 py-1 text-xs text-neutral-400"
        >
          {block.summary}
        </div>
      )
  }
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'

  return (
    <div className={cn('w-0 min-w-full flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 rounded-xl py-2 text-sm',
          isUser
            ? 'max-w-[85%] bg-neutral-700 px-3 text-white'
            : 'max-w-full text-neutral-100'
        )}
      >
        {message.content.map((block, i) => renderBlock(block, i, isStreaming))}
        {isStreaming && message.content.length === 0 && (
          <Loader2 className="size-4 animate-spin text-neutral-400" />
        )}
        {message.status === 'interrupted' && (
          <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
            <OctagonX className="size-3" />
            <span>Response interrupted</span>
          </div>
        )}
      </div>
    </div>
  )
}
