import { type ComponentType, type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { bindScrollEdgeFades, TABLE_SCROLL_EDGE_SELECTOR } from '@superone/ui/lib/scroll-edge-fade'
import { Check, Copy } from 'lucide-react'
import {
  Streamdown,
  type Components,
  type BlockProps,
  type ControlsConfig,
  type LinkSafetyConfig,
  type MathPlugin,
  type PluginConfig,
} from 'streamdown'
import { StreamFadeBlock } from './stream-fade-block'
import { createStreamFadePlugin, FadeBlockInnerContext } from './stream-fade'
import type { PluggableList } from 'unified'
import { splitByInsightBlocks } from '@superone/shared/insight-markers'

export interface CopyableMarkdownRuntime {
  components: Components
  controls: ControlsConfig
  getMathPluginSync: () => MathPlugin | null
  linkSafety?: LinkSafetyConfig
  loadMathPlugin: () => Promise<MathPlugin>
  plugins: PluginConfig
  remarkPlugins?: PluggableList
  rehypePlugins: PluggableList
  copyText: (text: string) => Promise<boolean>
  /** Streamdown table scroll cap; `Infinity` disables it. Falls back to Streamdown's default when unset. */
  tableMaxHeight?: number | string
  BlockComponent?: ComponentType<BlockProps>
}

export interface CopyableMarkdownPresenterProps {
  text: string
  isStreaming: boolean
  components?: Components
  runtime: CopyableMarkdownRuntime
}

function markdownBlockOptions(text: string, runtime: CopyableMarkdownRuntime) {
  const BlockComponent = text.length >= 8192 ? runtime.BlockComponent : undefined
  // Definitions may be referenced by any block: keep these documents atomic.
  const atomic = !!BlockComponent && /^ {0,3}\[[^\]]+\]:/m.test(text)
  return { BlockComponent, mode: atomic ? 'static' as const : 'streaming' as const }
}

export { splitByInsightBlocks }

function ChatMarkdown({ text, isStreaming, components, runtime, plugins }: {
  text: string
  isStreaming: boolean
  components: Components
  runtime: CopyableMarkdownRuntime
  plugins: PluginConfig
}) {
  const options = markdownBlockOptions(text, runtime)
  const [staticFade] = useState(() => createStreamFadePlugin())
  const staticStreaming = isStreaming && options.mode === 'static'
  if (staticStreaming) staticFade.bind()
  useLayoutEffect(() => {
    if (staticStreaming) staticFade.commit()
    else staticFade.reset()
  }, [text, staticStreaming, staticFade])
  const rehypePlugins = staticStreaming
    ? [...runtime.rehypePlugins, staticFade.rehype]
    : runtime.rehypePlugins
  return (
    <FadeBlockInnerContext.Provider value={options.BlockComponent}>
      <Streamdown
        BlockComponent={isStreaming && options.mode !== 'static' ? StreamFadeBlock : options.BlockComponent}
        mode={options.mode}
        className="chat-md"
        plugins={plugins}
        remarkPlugins={runtime.remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        controls={runtime.controls}
        linkSafety={runtime.linkSafety}
        tableMaxHeight={runtime.tableMaxHeight}
        remend={REMEND_OPTIONS}
        isAnimating={isStreaming}
      >
        {text}
      </Streamdown>
    </FadeBlockInnerContext.Provider>
  )
}

const MATH_TRIGGER_RE = /\$\$|\\\(|\\\[|\\begin\{/

type MathPluginShape = MathPlugin | null

function useMathPluginForText(text: string, runtime: CopyableMarkdownRuntime): MathPluginShape {
  const needsMath = MATH_TRIGGER_RE.test(text)
  const [plugin, setPlugin] = useState<MathPluginShape>(() => runtime.getMathPluginSync())
  useEffect(() => {
    if (!needsMath || plugin) return
    let cancelled = false
    void runtime.loadMathPlugin().then((p) => { if (!cancelled) setPlugin(p) })
    return () => { cancelled = true }
  }, [needsMath, plugin, runtime])
  return needsMath ? plugin : null
}

/**
 * Streamdown repairs the tail of a streaming chunk through `remend`, and its
 * `htmlTags` handler drops everything from the last unclosed `<tag` to the end
 * of the text. It never checks whether that `<` sits inside math or code, so a
 * single `\sum_{j<k}` silently swallows the rest of the turn — the remaining
 * `$$` then gets auto-closed and KaTeX renders a muted parse error where the
 * answer should be. Chat markdown carries almost no raw HTML, so losing the
 * repair costs at most one frame of a half-typed tag rendered as text.
 */
const REMEND_OPTIONS = { htmlTags: false }

function ScrollEdgeFadeRoot({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    return bindScrollEdgeFades(root, TABLE_SCROLL_EDGE_SELECTOR)
  }, [])
  // No box of its own: the markdown block's margins stay where they were.
  // The element exists so the fade repair can see tables Streamdown adds later.
  return <div ref={rootRef} className="contents">{children}</div>
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

  return isStreaming ? throttled : text
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

export const InsightBlockPresenter = memo(function InsightBlock({ title, content, isStreaming, components, runtime }: { title: string; content: string; isStreaming: boolean; components?: Components; runtime: CopyableMarkdownRuntime }) {
  const [copied, setCopied] = useState(false)
  const normalized = useMemo(() => normalizeCodeFences(content), [content])
  const merged = useMemo(
    () => components
      ? { ...runtime.components, ...components, code: runtime.components.code }
      : runtime.components,
    [components, runtime],
  )
  const mathPlugin = useMathPluginForText(normalized, runtime)
  const plugins = useMemo(
    () => mathPlugin ? { ...runtime.plugins, math: mathPlugin } : runtime.plugins,
    [mathPlugin, runtime],
  )
  const handleCopy = useCallback(async () => {
    if (!(await runtime.copyText(content))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [content, runtime])

  return (
    <div className="group/insight relative my-3 border-l-[3px] border-insight-border bg-insight-bg pt-2.5 pb-1 pl-3 pr-2 hover:z-30 focus-within:z-30">
      <div className="mb-1 flex items-center text-xs font-semibold text-insight-fg">
        <span className="flex items-center gap-1.5">
          <span>★</span>
          <span>{title}</span>
        </span>
        <button
          onClick={handleCopy}
          className="relative z-30 ml-auto cursor-pointer rounded p-0.5 text-insight-fg opacity-0 transition-opacity group-hover/insight:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      <ScrollEdgeFadeRoot>
        <ChatMarkdown text={normalized} isStreaming={isStreaming} components={merged} runtime={runtime} plugins={plugins} />
      </ScrollEdgeFadeRoot>
    </div>
  )
})

const MarkdownRenderer = memo(function MarkdownRenderer({ text, isStreaming, components, runtime }: { text: string; isStreaming: boolean; components?: Components; runtime: CopyableMarkdownRuntime }) {
  const normalized = useMemo(() => normalizeCodeFences(text), [text])
  const merged = useMemo(
    () => components
      ? { ...runtime.components, ...components, code: runtime.components.code }
      : runtime.components,
    [components, runtime],
  )
  const mathPlugin = useMathPluginForText(normalized, runtime)
  const plugins = useMemo(
    () => mathPlugin ? { ...runtime.plugins, math: mathPlugin } : runtime.plugins,
    [mathPlugin, runtime],
  )

  return (
    <ScrollEdgeFadeRoot>
      <ChatMarkdown text={normalized} isStreaming={isStreaming} components={merged} runtime={runtime} plugins={plugins} />
    </ScrollEdgeFadeRoot>
  )
})

export const CopyableMarkdownPresenter = memo(function CopyableMarkdownPresenter({ text, isStreaming, components, runtime }: CopyableMarkdownPresenterProps) {
  const renderText = useThrottledStreamingText(text, isStreaming)
  const segments = useMemo(() => splitByInsightBlocks(renderText, !isStreaming), [renderText, isStreaming])
  const hasInsight = segments.some((s) => s.type === 'insight')

  if (!hasInsight) {
    return <MarkdownRenderer text={renderText} isStreaming={isStreaming} components={components} runtime={runtime} />
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          if (!seg.content.trim()) return null
          return <MarkdownRenderer key={i} text={seg.content} isStreaming={isStreaming} components={components} runtime={runtime} />
        }
        return (
          <InsightBlockPresenter key={i} title={seg.title} content={seg.content} isStreaming={isStreaming} components={components} runtime={runtime} />
        )
      })}
    </>
  )
})
