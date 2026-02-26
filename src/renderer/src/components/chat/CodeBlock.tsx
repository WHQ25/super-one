import { useState, useCallback, useRef, useEffect, isValidElement } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import mermaid from 'mermaid'

let mermaidInitialized = false
function ensureMermaidInit() {
  if (mermaidInitialized) return
  mermaidInitialized = true
  mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrorRendering: true })
}

// --- Inline code ---

export function InlineCode({ children, className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      {...props}
      className={`rounded bg-muted px-1 py-0.5 text-xs text-foreground ${className ?? ''}`.trim()}
    >
      {children}
    </code>
  )
}

// --- Mermaid block ---

const MERMAID_DEBOUNCE_MS = 300

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSvg(null)
    setError(null)
    let cancelled = false
    const timer = setTimeout(() => {
      ensureMermaidInit()
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      mermaid.render(id, code).then(
        ({ svg: result }) => { if (!cancelled) setSvg(result) },
        (err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) },
      )
    }, MERMAID_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [code])

  if (error) {
    return (
      <div className="my-1.5 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs text-destructive">Mermaid Error: {error}</p>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="my-1.5 flex items-center justify-center rounded-md bg-muted/30 py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="my-1.5 overflow-x-auto rounded-md bg-muted/30 p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// --- Highlighted code block ---

interface HighlightedCodeBlockProps {
  code: string
  language: string
  codePlugin: CodeHighlighterPlugin
}

interface TokenLine {
  tokens: Array<{
    content: string
    color?: string
    bgColor?: string
    htmlStyle?: Record<string, string>
  }>
}

export function HighlightedCodeBlock({ code, language, codePlugin }: HighlightedCodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [lines, setLines] = useState<TokenLine[] | null>(null)
  const [colors, setColors] = useState<{ fg: string; bg: string }>({ fg: '#e1e4e8', bg: '#24292e' })
  const preRef = useRef<HTMLPreElement>(null)

  const applyHighlightResult = useCallback((res: { fg?: string; bg?: string; tokens: Array<Array<{ content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }>> }) => {
    setColors({ fg: res.fg ?? '#e1e4e8', bg: res.bg ?? '#24292e' })
    setLines(
      res.tokens.map((line) => ({
        tokens: line.map((t) => ({
          content: t.content,
          color: t.color,
          bgColor: t.bgColor,
          htmlStyle: t.htmlStyle,
        })),
      }))
    )
  }, [])

  const normalizeLanguage = useCallback((raw: string): string => {
    const value = raw.trim().toLowerCase()
    if (value === 'text' || value === 'plaintext' || value === 'txt') return 'md'
    return value || 'md'
  }, [])

  useEffect(() => {
    const themes = codePlugin.getThemes()
    const normalizedLanguage = normalizeLanguage(language)
    if (!codePlugin.supportsLanguage(normalizedLanguage as never)) {
      setLines(null)
      return
    }

    const result = codePlugin.highlight(
      { code, language: normalizedLanguage as never, themes },
      (res) => applyHighlightResult(res)
    )
    if (result) {
      applyHighlightResult(result)
    }
  }, [code, language, codePlugin, applyHighlightResult, normalizeLanguage])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="my-1.5 overflow-hidden rounded-md" style={{ backgroundColor: colors.bg }}>
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px]" style={{ color: colors.fg }}>
        <span className="opacity-50">{language}</span>
        <button
          onClick={handleCopy}
          className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto px-3 pb-3 text-xs leading-relaxed"
        style={{ color: colors.fg }}
      >
        <code>
          {lines
            ? lines.map((line, i) => (
                <span key={i}>
                  {line.tokens.map((t, j) => (
                    <span
                      key={j}
                      style={
                        (
                          t.color || t.bgColor || t.htmlStyle
                            ? { color: t.color, backgroundColor: t.bgColor, ...(t.htmlStyle ?? {}) }
                            : undefined
                        ) as React.CSSProperties | undefined
                      }
                    >
                      {t.content}
                    </span>
                  ))}
                  {i < lines.length - 1 && '\n'}
                </span>
              ))
            : code
          }
        </code>
      </pre>
    </div>
  )
}

interface StreamdownCodeNode {
  position?: {
    start?: { line?: number }
    end?: { line?: number }
  }
}

type StreamdownCodeProps = React.ComponentProps<'code'> & {
  node?: StreamdownCodeNode
}

function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map((child) => extractCodeText(child)).join('')
  if (isValidElement<{ children?: React.ReactNode }>(children)) {
    return extractCodeText(children.props.children ?? '')
  }
  return ''
}

/** Create a streamdown `components.code` renderer backed by our custom code block UI. */
export function createStreamdownCodeComponent(codePlugin: CodeHighlighterPlugin) {
  function StreamdownCode({ node, className, children, ...props }: StreamdownCodeProps) {
    const startLine = node?.position?.start?.line
    const endLine = node?.position?.end?.line
    const isInlineByPosition = startLine !== undefined && endLine !== undefined && startLine === endLine
    const code = extractCodeText(children)
    const hasLanguageClass = /language-/.test(className ?? '')
    const shouldRenderBlock = !isInlineByPosition || hasLanguageClass || code.includes('\n')

    if (!shouldRenderBlock) {
      return (
        <InlineCode className={className} {...props}>
          {children}
        </InlineCode>
      )
    }

    const language = className?.match(/language-([^\s]+)/)?.[1] ?? 'text'
    if (language === 'mermaid') return <MermaidBlock code={code} />
    return <HighlightedCodeBlock code={code} language={language} codePlugin={codePlugin} />
  }

  return StreamdownCode
}
