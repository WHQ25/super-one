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
  for (const line of lines) {
    if (!inFence) {
      const match = line.match(/^(`{3,})/)
      if (match) {
        if (current.length > 0) segments.push({ content: current.join('\n'), isCode: false })
        current = [line]
        inFence = true
        fenceTicks = match[1]
      } else {
        current.push(line)
      }
    } else {
      current.push(line)
      if (line.trimEnd() === fenceTicks) {
        segments.push({ content: current.join('\n'), isCode: true })
        current = []
        inFence = false
        fenceTicks = ''
      }
    }
  }
  if (current.length > 0) segments.push({ content: current.join('\n'), isCode: inFence })
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

export function CopyableMarkdown({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [indicatorTop, setIndicatorTop] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hoverInfoRef = useRef<HoverInfo | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const streamingCodeComponent = useMemo(
    () => createStreamdownCodeComponent(codePlugin, { textRef, isStreamingRef }),
    [],
  )
  const merged = useMemo(
    () => components
      ? { ...streamdownComponents, ...components, code: streamingCodeComponent }
      : { ...streamdownComponents, code: streamingCodeComponent },
    [components, streamingCodeComponent],
  )

  const textSegments = useMemo(() => {
    const all = splitByCodeFences(text)
    return all.filter((s) => !s.isCode).map((s) => s.content.trim())
  }, [text])

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
        {text}
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
