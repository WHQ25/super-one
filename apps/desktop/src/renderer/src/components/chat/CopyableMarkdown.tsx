import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy } from 'lucide-react'
import { loadMathPlugin, getMathPluginSync } from './chat-shared'

const MATH_TRIGGER_RE = /\$\$|\\\(|\\\[|\\begin\{/

type MathPluginShape = ReturnType<typeof getMathPluginSync>

function useMathPluginForText(text: string): MathPluginShape {
  const needsMath = MATH_TRIGGER_RE.test(text)
  const [plugin, setPlugin] = useState<MathPluginShape>(() => getMathPluginSync())
  useEffect(() => {
    if (!needsMath || plugin) return
    let cancelled = false
    void loadMathPlugin().then((p) => { if (!cancelled) setPlugin(p) })
    return () => { cancelled = true }
  }, [needsMath, plugin])
  return needsMath ? plugin : null
}

const STREAMING_THROTTLE_MS = 33

function useThrottledStreamingText(text: string, isStreaming: boolean): string {
  const [throttled, setThrottled] = useState(text)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommitRef = useRef(0)
  const latestTextRef = useRef(text)
  latestTextRef.current = text

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setThrottled(text)
      return
    }
    const elapsed = performance.now() - lastCommitRef.current
    if (elapsed >= STREAMING_THROTTLE_MS) {
      lastCommitRef.current = performance.now()
      setThrottled(latestTextRef.current)
    } else if (timerRef.current == null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        lastCommitRef.current = performance.now()
        setThrottled(latestTextRef.current)
      }, STREAMING_THROTTLE_MS - elapsed)
    }
  }, [text, isStreaming])

  useEffect(() => () => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
  }, [])

  return throttled
}
import {
  streamdownPlugins,
  streamdownControls,
  streamdownComponents,
  streamdownLinkSafety,
  streamdownRehypePlugins,
} from './chat-shared'
import { tryCopy } from '@/lib/clipboard'

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

const INSIGHT_HEADER_LINE = /^(.*?)(?:#{1,6}\s+)?`?★\s+(.+?)\s+─{1,}`?\s*$/
const INSIGHT_FOOTER_LINE = /^`?─{3,}`?\s*$/
const INSIGHT_INLINE_FOOTER_LINE = /^(?!`?─)(.+?\S)\s+`?─{3,}`?\s*$/
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
    const leading = headerMatch[1].trimEnd()
    const title = headerMatch[2].trim()
    if (leading) textBuf.push(leading)
    let footerIdx = -1
    let inlineFooterContent: string | null = null
    for (let j = i + 1; j < lines.length; j++) {
      if (INSIGHT_FOOTER_LINE.test(lines[j])) { footerIdx = j; inlineFooterContent = null; break }
      const inlineMatch = lines[j].match(INSIGHT_INLINE_FOOTER_LINE)
      if (inlineMatch) { footerIdx = j; inlineFooterContent = inlineMatch[1]; break }
    }
    if (footerIdx === -1) {
      flushText()
      textBuf.push(`\`★ ${title} ${'─'.repeat(37)}\``)
      for (let j = i + 1; j < lines.length; j++) textBuf.push(lines[j])
      i = lines.length
      break
    }
    const prevIsFence = !leading && textBuf.length > 0 && FENCE_LINE.test(textBuf[textBuf.length - 1])
    const nextIsFence = inlineFooterContent === null
      && footerIdx + 1 < lines.length
      && FENCE_LINE.test(lines[footerIdx + 1])
    const stripFences = prevIsFence && nextIsFence
    if (stripFences) textBuf.pop()
    flushText()
    const innerLines = lines.slice(i + 1, footerIdx)
    if (inlineFooterContent !== null) innerLines.push(inlineFooterContent)
    segments.push({
      type: 'insight',
      title,
      content: innerLines.join('\n'),
    })
    i = footerIdx + 1 + (stripFences ? 1 : 0)
  }
  flushText()
  return segments
}

const InsightBlock = memo(function InsightBlock({ title, content, isStreaming, components }: { title: string; content: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const [copied, setCopied] = useState(false)
  const normalized = useMemo(() => normalizeCodeFences(content), [content])
  const merged = useMemo(
    () => components
      ? { ...streamdownComponents, ...components, code: streamdownComponents.code }
      : streamdownComponents,
    [components],
  )
  const mathPlugin = useMathPluginForText(normalized)
  const plugins = useMemo(
    () => mathPlugin ? { ...streamdownPlugins, math: mathPlugin } : streamdownPlugins,
    [mathPlugin],
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
        plugins={plugins}
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
})

const MarkdownRenderer = memo(function MarkdownRenderer({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const normalized = useMemo(() => normalizeCodeFences(text), [text])
  const merged = useMemo(
    () => components
      ? { ...streamdownComponents, ...components, code: streamdownComponents.code }
      : streamdownComponents,
    [components],
  )
  const mathPlugin = useMathPluginForText(normalized)
  const plugins = useMemo(
    () => mathPlugin ? { ...streamdownPlugins, math: mathPlugin } : streamdownPlugins,
    [mathPlugin],
  )

  return (
    <Streamdown
      className="chat-md"
      plugins={plugins}
      rehypePlugins={streamdownRehypePlugins}
      components={merged}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
      isAnimating={isStreaming}
    >
      {normalized}
    </Streamdown>
  )
})

export const CopyableMarkdown = memo(function CopyableMarkdown({ text, isStreaming, components }: { text: string; isStreaming: boolean; components?: Record<string, React.ComponentType<never>> }) {
  const renderText = useThrottledStreamingText(text, isStreaming)
  const segments = useMemo(() => splitByInsightBlocks(renderText), [renderText])
  const hasInsight = segments.some((s) => s.type === 'insight')

  if (!hasInsight) {
    return <MarkdownRenderer text={renderText} isStreaming={isStreaming} components={components} />
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
})
