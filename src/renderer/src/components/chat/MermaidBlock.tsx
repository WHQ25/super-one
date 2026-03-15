import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, Code, Copy, Expand, Eye, Loader2 } from 'lucide-react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import mermaid from 'mermaid'
import { useIsDark } from '@/hooks/use-is-dark'
import { HighlightedCodeBlock } from './CodeBlock'
import { MermaidFullscreen } from './MermaidFullscreen'

interface MermaidBlockProps {
  code: string
  isComplete: boolean
  codePlugin: CodeHighlighterPlugin
}

export function MermaidBlock({ code, isComplete, codePlugin }: MermaidBlockProps) {
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
    return <HighlightedCodeBlock code={code} language="mermaid" codePlugin={codePlugin} />
  }

  const toolbar = (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="opacity-50">Mermaid</span>
      <div className="flex items-center gap-1">
        {svg && (
          <button
            onClick={() => setShowSource((v) => !v)}
            className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
            title={showSource ? 'Preview' : 'Source'}
          >
            {showSource ? <Eye className="size-3.5" /> : <Code className="size-3.5" />}
          </button>
        )}
        {svg && !showSource && (
          <button
            onClick={() => setFullscreenOpen(true)}
            className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
            title="Expand"
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
            <div className="relative">
              <div
                className="overflow-x-auto p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              {isThemeSwitching && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
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
