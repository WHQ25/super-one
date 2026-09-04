import {
  Suspense,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Check, Copy } from 'lucide-react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { useIsCodeFenceIncomplete } from 'streamdown'

const DARK_FG = '#e1e4e8'
const LIGHT_FG = '#24292e'

export function InlineCode({ children, className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      {...props}
      className={`rounded bg-primary/8 px-1 py-0.5 text-xs font-medium text-primary/90 ${className ?? ''}`.trim()}
    >
      {children}
    </code>
  )
}

// --- Highlighted code block ---

export interface HighlightResult {
  fg?: string
  bg?: string
  tokens: Array<Array<{
    content: string
    color?: string
    bgColor?: string
    htmlStyle?: Record<string, string>
  }>>
}

export interface HighlightedCodeBlockPresenterPorts {
  isDark: boolean
  lightCodePlugin: CodeHighlighterPlugin
  copyText: (text: string) => Promise<boolean>
  isRhaiLanguage: (language: string) => boolean
  highlightRhai: (
    code: string,
    themes: readonly unknown[],
    callback: (result: HighlightResult) => void,
  ) => HighlightResult | null
}

export interface HighlightedCodeBlockPresenterProps {
  code: string
  language: string
  codePlugin: CodeHighlighterPlugin
  isComplete?: boolean
  ports: HighlightedCodeBlockPresenterPorts
}

export interface StreamdownCodePresenterPorts {
  renderHighlightedCode: (props: Omit<HighlightedCodeBlockPresenterProps, 'ports'>) => ReactNode
  renderMermaid: (props: {
    code: string
    isComplete: boolean
    codePlugin: CodeHighlighterPlugin
  }) => ReactNode
}

interface TokenLine {
  tokens: Array<{
    content: string
    color?: string
    bgColor?: string
    htmlStyle?: Record<string, string>
  }>
}

export function HighlightedCodeBlockPresenter({ code, language, codePlugin, isComplete = true, ports }: HighlightedCodeBlockPresenterProps) {
  const activePlugin = ports.isDark ? codePlugin : ports.lightCodePlugin
  const fallbackFg = ports.isDark ? DARK_FG : LIGHT_FG
  const [copied, setCopied] = useState(false)
  const [lines, setLines] = useState<TokenLine[] | null>(null)
  const [fg, setFg] = useState<string>(fallbackFg)
  const preRef = useRef<HTMLPreElement>(null)

  const applyHighlightResult = useCallback((res: { fg?: string; bg?: string; tokens: Array<Array<{ content: string; color?: string; bgColor?: string; htmlStyle?: Record<string, string> }>> }) => {
    setFg(res.fg ?? fallbackFg)
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
  }, [fallbackFg])

  const normalizeLanguage = useCallback((raw: string): string => {
    const value = raw.trim().toLowerCase()
    if (value === 'text' || value === 'plaintext' || value === 'txt') return 'md'
    if (value === 'rhai') return 'rhai'
    return value || 'md'
  }, [])

  useEffect(() => {
    if (!isComplete) {
      setLines(null)
      setFg(fallbackFg)
      return
    }
    const themes = activePlugin.getThemes()
    const normalizedLanguage = normalizeLanguage(language)

    // Rhai is not a Shiki bundled language — use official vscode-rhai TextMate grammar.
    if (ports.isRhaiLanguage(normalizedLanguage)) {
      const result = ports.highlightRhai(code, themes, (res) => applyHighlightResult(res))
      if (result) applyHighlightResult(result)
      else {
        // Keep monochrome until async grammar load finishes (avoid flash of wrong lang).
        setLines(null)
        setFg(fallbackFg)
      }
      return
    }

    if (!activePlugin.supportsLanguage(normalizedLanguage as never)) {
      setLines(null)
      return
    }

    const result = activePlugin.highlight(
      { code, language: normalizedLanguage as never, themes },
      (res) => applyHighlightResult(res)
    )
    if (result) {
      applyHighlightResult(result)
    }
  }, [code, language, activePlugin, applyHighlightResult, normalizeLanguage, isComplete, fallbackFg])

  const handleCopy = useCallback(async () => {
    if (!(await ports.copyText(code))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code, ports])

  return (
    <div data-chat-codeblock className="my-1.5 overflow-hidden rounded-md bg-muted/20">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
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
        style={{ color: fg }}
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

export function createStreamdownCodeComponentPresenter(codePlugin: CodeHighlighterPlugin, ports: StreamdownCodePresenterPorts) {
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
          {ports.renderMermaid({ code, isComplete, codePlugin })}
        </Suspense>
      )
    }
    return ports.renderHighlightedCode({ code, language, codePlugin, isComplete })
  }

  return StreamdownCode
}
