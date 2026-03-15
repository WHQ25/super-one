import { useState, useRef, useMemo, type PointerEvent } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  codePlugin,
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
} from './chat-shared'
import { createStreamdownCodeComponent } from './CodeBlock'

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
      className={cn('z-10 cursor-pointer rounded bg-background/85 p-0.5 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border/60 backdrop-blur-[2px] transition-opacity hover:text-foreground group-hover/copy:opacity-100', className ?? 'absolute right-0 top-0')}
    >
      {copied
        ? <Check className="size-3 text-green-400" />
        : <Copy className="size-3" />
      }
    </button>
  )
}

export function CopyableMarkdown({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const [isCodeBlockHovered, setIsCodeBlockHovered] = useState(false)
  const textRef = useRef(text)
  textRef.current = text
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const streamingCodeComponent = useMemo(
    () => createStreamdownCodeComponent(codePlugin, { textRef, isStreamingRef }),
    [],
  )
  const merged = components
    ? { ...streamdownComponents, ...components, code: streamingCodeComponent }
    : { ...streamdownComponents, code: streamingCodeComponent }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    setIsCodeBlockHovered(Boolean((event.target as HTMLElement | null)?.closest('[data-chat-codeblock]')))
  }

  return (
    <div
      className="group/copy relative"
      onPointerLeave={() => setIsCodeBlockHovered(false)}
      onPointerMove={handlePointerMove}
    >
      <Streamdown
        className="chat-md"
        plugins={streamdownPlugins}
        components={merged}
        controls={streamdownControls}
        linkSafety={streamdownLinkSafety}
        isAnimating={isStreaming}
      >
        {text}
      </Streamdown>
      {!isStreaming && text.length > 0 && !isCodeBlockHovered && <CopyButton text={text} />}
    </div>
  )
}
