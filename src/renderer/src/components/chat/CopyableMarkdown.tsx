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

const INSIGHT_HEADER_LINE = /^`?★\s+(.+?)\s+─{3,}`?\s*$/
const INSIGHT_FOOTER_LINE = /^`?─{3,}`?\s*$/
const FENCE_LINE = /^`{3,}[\w-]*\s*$/

type TextSegment = { type: 'text'; content: string } | { type: 'insight'; title: string; content: string }

export function splitByInsightBlocks(text: string): TextSegment[] {
  const lines = text.split('\n')
  const segments: TextSegment[] = []
  let textBuf: string[] = []

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', content: textBuf.join('\n') })
      textBuf = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const headerMatch = lines[i].match(INSIGHT_HEADER_LINE)
    if (!headerMatch) {
      textBuf.push(lines[i])
      i++
      continue
    }
    let footerIdx = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (INSIGHT_FOOTER_LINE.test(lines[j])) { footerIdx = j; break }
    }
    if (footerIdx === -1) {
      flushText()
      textBuf.push(`\`★ ${headerMatch[1].trim()} ${'─'.repeat(37)}\``)
      for (let j = i + 1; j < lines.length; j++) textBuf.push(lines[j])
      i = lines.length
      break
    }
    const prevIsFence = textBuf.length > 0 && FENCE_LINE.test(textBuf[textBuf.length - 1])
    const nextIsFence = footerIdx + 1 < lines.length && FENCE_LINE.test(lines[footerIdx + 1])
    const stripFences = prevIsFence && nextIsFence
    if (stripFences) textBuf.pop()
    flushText()
    segments.push({
      type: 'insight',
      title: headerMatch[1].trim(),
      content: lines.slice(i + 1, footerIdx).join('\n'),
    })
    i = footerIdx + 1 + (stripFences ? 1 : 0)
  }
  flushText()
  return segments
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
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [content])

  return (
    <div className="group/insight my-3 border-l-[3px] pt-2.5 pb-1 pl-3 pr-2" style={{ borderColor: 'oklch(0.65 0.15 280)', background: 'oklch(0.65 0.1 280 / 0.13)' }}>
      <div className="mb-1 flex items-center text-[13px] font-semibold" style={{ color: 'oklch(0.7 0.15 280)' }}>
        <span className="flex items-center gap-1.5">
          <span>★</span>
          <span>{title}</span>
        </span>
        <button
          onClick={handleCopy}
          className="ml-auto cursor-pointer rounded p-0.5 opacity-0 transition-opacity group-hover/insight:opacity-100"
          style={{ color: 'oklch(0.7 0.15 280)' }}
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
  const segments = useMemo(() => splitByInsightBlocks(text), [text])
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
