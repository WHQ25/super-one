import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react'
import { Streamdown } from 'streamdown'
import { Check, Copy } from 'lucide-react'
import { loadMathPlugin, getMathPluginSync } from './chat-shared'
import { splitByInsightBlocks } from '@superone/shared/insight-markers'

export { splitByInsightBlocks }

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
      <div className="mb-1 flex items-center text-xs font-semibold text-insight-fg">
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
  const segments = useMemo(() => splitByInsightBlocks(renderText, !isStreaming), [renderText, isStreaming])
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
