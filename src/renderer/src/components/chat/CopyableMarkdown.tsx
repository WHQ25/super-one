import { useState, useRef, useMemo, useCallback, type PointerEvent, type MouseEvent } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy } from 'lucide-react'
import {
  codePlugin,
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
} from './chat-shared'
import { createStreamdownCodeComponent } from './CodeBlock'

function CopyIndicator({ copied, onCopy }: { copied: boolean; onCopy: (e: MouseEvent) => void }) {
  return (
    <button
      onClick={onCopy}
      className="z-10 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
    </button>
  )
}

function isCodeBlockEl(el: Element): boolean {
  return el.hasAttribute('data-chat-codeblock') || !!el.querySelector('[data-chat-codeblock]')
}

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

const INSIGHT_HEADER_LINE = /^`★\s+(.+?)\s+─{3,}`$/
const INSIGHT_FOOTER_LINE = /^`─{3,}`$/

type TextSegment = { type: 'text'; content: string } | { type: 'insight'; title: string; content: string }

export function splitByInsightBlocks(text: string): TextSegment[] {
  const lines = text.split('\n')
  const segments: TextSegment[] = []
  let current: string[] = []
  let insightTitle: string | null = null
  let insightLines: string[] = []
  for (const line of lines) {
    if (insightTitle === null) {
      const m = line.match(INSIGHT_HEADER_LINE)
      if (m) {
        if (current.length > 0) segments.push({ type: 'text', content: current.join('\n') })
        current = []
        insightTitle = m[1].trim()
        insightLines = []
      } else {
        current.push(line)
      }
    } else {
      if (INSIGHT_FOOTER_LINE.test(line)) {
        segments.push({ type: 'insight', title: insightTitle, content: insightLines.join('\n') })
        insightTitle = null
        insightLines = []
      } else {
        insightLines.push(line)
      }
    }
  }
  if (insightTitle !== null) {
    current.push(`\`★ ${insightTitle} ${'─'.repeat(37)}\``)
    current.push(...insightLines)
  }
  if (current.length > 0) segments.push({ type: 'text', content: current.join('\n') })
  return segments
}

interface HoverInfo {
  top: number
  textSegmentIndex: number
}

function findHoverInfo(target: HTMLElement, wrapper: HTMLElement): HoverInfo | null {
  if (target.closest('[data-chat-codeblock]')) return null
  const chatMd = wrapper.querySelector('.chat-md')
  if (!chatMd) return null
  let el: HTMLElement | null = target
  while (el && el.parentElement !== chatMd) {
    el = el.parentElement as HTMLElement | null
  }
  if (!el) return null
  const children = Array.from(chatMd.children)
  const elIndex = children.indexOf(el)
  if (elIndex < 0) return null
  let textSegmentIndex = 0
  let firstInSegment: HTMLElement = el
  for (let i = 0; i < elIndex; i++) {
    if (isCodeBlockEl(children[i])) textSegmentIndex++
  }
  for (let i = elIndex - 1; i >= 0; i--) {
    if (isCodeBlockEl(children[i])) break
    firstInSegment = children[i] as HTMLElement
  }
  return { top: firstInSegment.offsetTop, textSegmentIndex }
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
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [indicatorTop, setIndicatorTop] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hoverInfoRef = useRef<HoverInfo | null>(null)
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

  const textSegments = useMemo(() => {
    const all = splitByCodeFences(normalized)
    return all.filter((s) => !s.isCode).map((s) => s.content.trim())
  }, [normalized])

  const copySegment = useCallback((index: number, top: number) => {
    const md = textSegments[index]
    if (!md) return
    navigator.clipboard.writeText(md)
    setIndicatorTop(top)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [textSegments])

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!wrapperRef.current) return
    const info = findHoverInfo(event.target as HTMLElement, wrapperRef.current)
    hoverInfoRef.current = info
    const nowHovered = info !== null
    if (nowHovered !== hovered) setHovered(nowHovered)
    if (info && !copied && info.top !== indicatorTop) setIndicatorTop(info.top)
  }

  const handleButtonCopy = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    const info = hoverInfoRef.current
    if (info) copySegment(info.textSegmentIndex, info.top)
  }, [copySegment])

  const showIndicator = !isStreaming && (hovered || copied)

  return (
    <div
      ref={wrapperRef}
      className="group/copy relative"
      onPointerLeave={() => { if (!copied) setHovered(false) }}
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
        {normalized}
      </Streamdown>
      {showIndicator && (
        <div
          className="absolute right-0 opacity-0 group-hover/copy:opacity-100"
          style={{ top: indicatorTop, transition: copied ? 'none' : 'opacity 150ms' }}
        >
          <CopyIndicator copied={copied} onCopy={handleButtonCopy} />
        </div>
      )}
    </div>
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
