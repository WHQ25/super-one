import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Code, Copy, Expand, Eye, Loader2 } from 'lucide-react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import mermaid from 'mermaid'
import { useIsDark } from '@/hooks/use-is-dark'
import { HighlightedCodeBlock } from './CodeBlock'
import { MermaidFullscreen } from './MermaidFullscreen'

export const MAX_H = 500
export const OVERFLOW_THRESHOLD = 0.3
export const OVERFLOW_RENDER_RATIO = 0.6

export function parseSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="([^"]+)"/)
  if (!m) return { w: 0, h: 0 }
  const [, , w, h] = m[1].split(/[\s,]+/).map(Number)
  return { w: Number.isFinite(w) && w > 0 ? w : 0, h: Number.isFinite(h) && h > 0 ? h : 0 }
}

export function computeLayout(
  svgW: number,
  svgH: number,
  containerW: number,
): { overflow: boolean; overflowW: number } {
  if (containerW <= 0 || svgW <= 0 || svgH <= 0) return { overflow: false, overflowW: 0 }
  const widthScale = Math.min(containerW / svgW, 1)
  if (svgH * widthScale <= MAX_H) return { overflow: false, overflowW: 0 }
  const fittedW = svgW * (MAX_H / svgH)
  if (fittedW >= containerW * OVERFLOW_THRESHOLD) return { overflow: false, overflowW: 0 }
  return { overflow: true, overflowW: containerW * OVERFLOW_RENDER_RATIO }
}

export function MermaidPreview({ svg, isThemeSwitching }: {
  svg: string
  isThemeSwitching: boolean
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const { w: svgW, h: svgH } = useMemo(() => parseSize(svg), [svg])

  useEffect(() => {
    if (!outerRef.current) return
    const ro = new ResizeObserver(([entry]) => setContainerW(entry.contentRect.width))
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  const { overflow, overflowW } = computeLayout(svgW, svgH, containerW)

  return (
    <div className="relative">
      <div
        ref={outerRef}
        className={overflow
          ? 'overflow-auto p-4'
          : 'p-4 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-[500px]'
        }
        style={overflow ? { maxHeight: MAX_H } : undefined}
      >
        {overflow
          ? (
            <div
              className="mx-auto [&_svg]:block [&_svg]:w-full [&_svg]:h-auto [&_svg]:!max-w-full"
              style={{ width: overflowW }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
          : (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          )
        }
      </div>
      {isThemeSwitching && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

interface MermaidBlockProps {
  code: string
  isComplete: boolean
  codePlugin: CodeHighlighterPlugin
}

export function MermaidBlock({ code, isComplete, codePlugin }: MermaidBlockProps) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isThemeSwitching, setIsThemeSwitching] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const prevDarkRef = useRef(isDark)

  useEffect(() => {
    if (!isComplete) {
      setSvg(null)
      setError(null)
      return
    }

    const isThemeChange = prevDarkRef.current !== isDark
    if (isThemeChange && svg) {
      setIsThemeSwitching(true)
    } else {
      setSvg(null)
      setError(null)
    }

    let cancelled = false
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      suppressErrorRendering: true,
    })
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    mermaid.render(id, code).then(
      ({ svg: result }) => {
        if (cancelled) return
        setSvg(result)
        setError(null)
        prevDarkRef.current = isDark
      },
      (err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      },
    ).finally(() => {
      if (!cancelled) setIsThemeSwitching(false)
    })
    return () => { cancelled = true }
  }, [code, isComplete, isDark])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  if (!isComplete) {
    return <HighlightedCodeBlock code={code} language="mermaid" codePlugin={codePlugin} isComplete={false} />
  }

  const toolbar = (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="opacity-50">Mermaid</span>
      <div className="flex items-center gap-1">
        {svg && (
          <button
            onClick={() => setShowSource((v) => !v)}
            className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
            title={showSource ? t('tooltips.mermaidPreview') : t('tooltips.mermaidSource')}
          >
            {showSource ? <Eye className="size-3.5" /> : <Code className="size-3.5" />}
          </button>
        )}
        {svg && !showSource && (
          <button
            onClick={() => setFullscreenOpen(true)}
            className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
            title={t('tooltips.expand')}
          >
            <Expand className="size-3.5" />
          </button>
        )}
        <button
          onClick={handleCopy}
          className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  )

  if (error) {
    return (
      <div data-chat-codeblock className="my-1.5 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5">
        {toolbar}
        <p className="px-3 pb-3 text-xs text-destructive">Mermaid Error: {error}</p>
      </div>
    )
  }

  if (!svg) {
    return (
      <div data-chat-codeblock className="my-1.5 overflow-hidden rounded-md bg-muted/30">
        {toolbar}
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <>
      <div data-chat-codeblock className="my-1.5 overflow-hidden rounded-md bg-muted/30">
        {toolbar}
        {showSource
          ? (
            <pre className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
              <code>{code}</code>
            </pre>
          )
          : (
            <MermaidPreview
              svg={svg}
              isThemeSwitching={isThemeSwitching}
            />
          )
        }
      </div>
      <MermaidFullscreen
        svg={svg}
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
      />
    </>
  )
}
