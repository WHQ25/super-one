import { useState, useCallback, useRef, useEffect, isValidElement, lazy, Suspense } from 'react'
import { Check, Copy } from 'lucide-react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { useIsCodeFenceIncomplete } from 'streamdown'
import { tryCopy } from '@/lib/clipboard'

const MermaidBlock = lazy(() => import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })))

export function InlineCode({ children, className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      {...props}
      className={`rounded bg-primary/10 px-1 py-0.5 text-xs font-medium text-primary/80 ${className ?? ''}`.trim()}
    >
      {children}
    </code>
  )
}

// --- Highlighted code block ---

interface HighlightedCodeBlockProps {
  code: string
  language: string
  codePlugin: CodeHighlighterPlugin
  isComplete?: boolean
}

interface TokenLine {
  tokens: Array<{
    content: string
    color?: string
    bgColor?: string
    htmlStyle?: Record<string, string>
  }>
}

export function HighlightedCodeBlock({ code, language, codePlugin, isComplete = true }: HighlightedCodeBlockProps) {
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
    if (!isComplete) {
      setLines(null)
      return
    }
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
  }, [code, language, codePlugin, applyHighlightResult, normalizeLanguage, isComplete])

  const handleCopy = useCallback(async () => {
    if (!(await tryCopy(code))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div data-chat-codeblock className="my-1.5 overflow-hidden rounded-md" style={{ backgroundColor: colors.bg }}>
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

export function createStreamdownCodeComponent(codePlugin: CodeHighlighterPlugin) {
  function StreamdownCode({ node, className, children, ...props }: StreamdownCodeProps) {
    const isComplete = !useIsCodeFenceIncomplete()
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
    if (language === 'mermaid') {
      return (
        <Suspense fallback={<pre className="my-1.5 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs opacity-60">{code}</pre>}>
          <MermaidBlock code={code} isComplete={isComplete} codePlugin={codePlugin} />
        </Suspense>
      )
    }
    return <HighlightedCodeBlock code={code} language={language} codePlugin={codePlugin} isComplete={isComplete} />
  }

  return StreamdownCode
}
