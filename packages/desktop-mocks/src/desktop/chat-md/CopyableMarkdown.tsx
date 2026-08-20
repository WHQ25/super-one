import { useState, useRef, useMemo, useCallback } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy } from 'lucide-react'
import {
  codePlugin,
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  streamdownRehypePlugins,
} from './chat-shared'
import { createStreamdownCodeComponent } from './CodeBlock'
import { tryCopy } from './clipboard'
import { splitByInsightBlocks } from '@superone/shared/insight-markers'

export { splitByInsightBlocks }

export function splitByCodeFences(text: string): { content: string; isCode: boolean }[] {
  const segments: { content: string; isCode: boolean }[] = []
  const lines = text.split('\n')
  let current: string[] = []
  let inFence = false
  let fenceTicks = ''
  let nestedDepth = 0
  for (const line of lines) {
    if (!inFence) {
      const match = line.match(/^(`{3,})/)
      if (match) {
        if (current.length > 0) segments.push({ content: current.join('\n'), isCode: false })
        current = [line]
        inFence = true
        fenceTicks = match[1]
        nestedDepth = 0
      } else {
        current.push(line)
      }
    } else {
      current.push(line)
      if (line.trimEnd() === fenceTicks) {
        if (nestedDepth > 0) {
          nestedDepth--
        } else {
          segments.push({ content: current.join('\n'), isCode: true })
          current = []
          inFence = false
          fenceTicks = ''
        }
      } else {
        const innerMatch = line.match(/^(`{3,})\S/)
        if (innerMatch && innerMatch[1] === fenceTicks) {
          nestedDepth++
        }
      }
    }
  }
  if (current.length > 0) segments.push({ content: current.join('\n'), isCode: inFence })
  return segments
}

export function normalizeCodeFences(text: string): string {
  const segments = splitByCodeFences(text)
  return segments.map((seg) => {
    if (!seg.isCode) return seg.content
    const lines = seg.content.split('\n')
    const openMatch = lines[0].match(/^(`{3,})(.*)$/)
    if (!openMatch) return seg.content
    const outerTicks = openMatch[1]
    const lang = openMatch[2]
    const body = lines.slice(1)
    const closingIdx = body.length - 1
    const isClosed = closingIdx >= 0 && body[closingIdx].trimEnd() === outerTicks
    const inner = isClosed ? body.slice(0, closingIdx) : body
    let maxInner = 0
    for (const line of inner) {
      const m = line.match(/^(`{3,})/)
      if (m && m[1].length > maxInner) maxInner = m[1].length
    }
    if (maxInner < outerTicks.length) return seg.content
    const newTicks = '`'.repeat(maxInner + 1)
    const result = [newTicks + lang, ...inner]
    if (isClosed) result.push(newTicks)
    return result.join('\n')
  }).join('\n')
}

function InsightBlock({ title, content, isStreaming, components }: { title: string; content: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const [copied, setCopied] = useState(false)
  const normalized = useMemo(() => normalizeCodeFences(content), [content])
  const textRef = useRef(normalized)
  textRef.current = normalized
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const codeComponent = useMemo(
    () => createStreamdownCodeComponent(codePlugin, { textRef, isStreamingRef }),
    [isStreaming],
  )
  const merged = useMemo(
    () => components
      ? { ...streamdownComponents, ...components, code: codeComponent }
      : { ...streamdownComponents, code: codeComponent },
    [components, codeComponent],
  )
  const handleCopy = useCallback(async () => {
    if (!(await tryCopy(content))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [content])

  return (
    <div className="group/insight my-3 border-l-[3px] border-insight-border bg-insight-bg pt-2.5 pb-1 pl-3 pr-2">
      <div className="mb-1 flex items-center text-[13px] font-semibold text-insight-fg">
        <span className="flex items-center gap-1.5">
          <span>★</span>
          <span>{title}</span>
        </span>
        <button
          onClick={handleCopy}
          className="ml-auto cursor-pointer rounded p-0.5 text-insight-fg opacity-0 transition-opacity group-hover/insight:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <Streamdown
        className="chat-md"
        plugins={streamdownPlugins}
        rehypePlugins={streamdownRehypePlugins}
        components={merged}
        controls={streamdownControls}
        linkSafety={streamdownLinkSafety}
        isAnimating={isStreaming}
      >
        {normalized}
      </Streamdown>
    </div>
  )
}

function MarkdownRenderer({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const normalized = useMemo(() => normalizeCodeFences(text), [text])
  const textRef = useRef(normalized)
  textRef.current = normalized
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const streamingCodeComponent = useMemo(
    () => createStreamdownCodeComponent(codePlugin, { textRef, isStreamingRef }),
    [isStreaming],
  )
  const merged = useMemo(
    () => components
      ? { ...streamdownComponents, ...components, code: streamingCodeComponent }
      : { ...streamdownComponents, code: streamingCodeComponent },
    [components, streamingCodeComponent],
  )

  return (
    <Streamdown
      className="chat-md"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={merged}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
      isAnimating={isStreaming}
    >
      {normalized}
    </Streamdown>
  )
}

export function CopyableMarkdown({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const segments = useMemo(() => splitByInsightBlocks(text, !isStreaming), [text, isStreaming])
  const hasInsight = segments.some((s) => s.type === 'insight')

  if (!hasInsight) {
    return <MarkdownRenderer text={text} isStreaming={isStreaming} components={components} />
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          if (!seg.content.trim()) return null
          return <MarkdownRenderer key={i} text={seg.content} isStreaming={isStreaming} components={components} />
        }
        return (
          <InsightBlock key={i} title={seg.title} content={seg.content} isStreaming={isStreaming} components={components} />
        )
      })}
    </>
  )
}
