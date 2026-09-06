import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Streamdown } from 'streamdown'
import DOMPurify from 'dompurify'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin, streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety } from './chat-shared'
import { tryPrettifyJson } from './tool-block-utils'
import { AskUserQuestionResultPresenter } from '@superone/chat-view/presenters/AskUserQuestionResult'
import type { QuestionAnnotations, QuestionPreviewFormat, UserQuestion } from '@superone/shared/agent-types'

export function SectionLabel({ children }: { children: string }) {
  return <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{children}</div>
}

/**
 * The failure message inside a tool body — small, amber, wrapped. Errors are prose, so they get
 * prose treatment: a code block would frame a sentence as a payload and invite the reader (and
 * the copy button) to treat it as data. `text-warning` is the error tone the row already uses;
 * `destructive` is reserved for actions that destroy something.
 */
export function ToolErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('whitespace-pre-wrap break-words text-xs text-warning/90', className)}>
      {children}
    </div>
  )
}

/** Lazily prettify a JS snippet with Prettier (loaded on demand). Falls back to the raw source. */
function usePrettyJs(code: string): string {
  const [pretty, setPretty] = useState(code)
  useEffect(() => {
    let cancelled = false
    setPretty(code)
    if (!code.trim()) return
    void (async () => {
      try {
        const [standalone, estree, babel] = await Promise.all([
          import('prettier/standalone'),
          import('prettier/plugins/estree'),
          import('prettier/plugins/babel'),
        ])
        const out = await standalone.format(code, {
          parser: 'babel',
          plugins: [babel.default ?? babel, estree.default ?? estree],
          printWidth: 100,
        })
        if (!cancelled) setPretty(out.trimEnd())
      } catch {
        if (!cancelled) setPretty(code)
      }
    })()
    return () => { cancelled = true }
  }, [code])
  return pretty
}

/** Expanded view for browser_evaluate: the JS expression that ran, then its result. */
export function BrowserEvaluateView({ expression, result }: { expression: string; result: string }) {
  const { t } = useTranslation()
  const prettyExpression = usePrettyJs(expression)
  return (
    <div className="space-y-2">
      {expression && (
        <div>
          <SectionLabel>{t('chat.toolBlock.browser.code')}</SectionLabel>
          <div className="-mx-2">
            <HighlightedCodeBlock code={prettyExpression} language="javascript" codePlugin={codePlugin} />
          </div>
        </div>
      )}
      <div>
        <SectionLabel>{t('chat.toolBlock.browser.result')}</SectionLabel>
        <PrettyJSONCodeBlock text={result} />
      </div>
    </div>
  )
}

function MockRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground/70">{label}</span>
      <span className="min-w-0 break-all text-foreground">{value}</span>
    </div>
  )
}

/** Expanded view for browser_mock: the mock rule config, sourced from the tool input. */
export function BrowserMockView({ params }: { params: Record<string, unknown> }) {
  const { t } = useTranslation()
  const url = typeof params.url === 'string' ? params.url : ''
  const status = typeof params.status === 'number' ? params.status : 200
  const contentType = typeof params.contentType === 'string' ? params.contentType : 'application/json'
  const headers = params.headers && typeof params.headers === 'object' ? (params.headers as Record<string, unknown>) : null
  const body = typeof params.body === 'string' ? params.body : ''

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <MockRow label={t('chat.toolBlock.browser.mockUrl')} value={url} />
        <MockRow label={t('chat.toolBlock.browser.mockStatus')} value={String(status)} />
        <MockRow label={t('chat.toolBlock.browser.mockContentType')} value={contentType} />
        {headers &&
          Object.entries(headers).map(([k, v]) => <MockRow key={k} label={k} value={String(v)} />)}
      </div>
      {body && (
        <div>
          <SectionLabel>{t('chat.toolBlock.browser.mockBody')}</SectionLabel>
          <PrettyJSONCodeBlock text={body} />
        </div>
      )}
    </div>
  )
}

/** Code block that shows the first 20 lines and reveals the rest on demand. */
export function TruncatedCodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation()
  const lines = code.split('\n')
  const previewLines = 20
  const isLong = lines.length > previewLines
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - previewLines
  const visibleText = showAll || !isLong ? code : lines.slice(0, previewLines).join('\n')

  return (
    <div className="-mx-2">
      <HighlightedCodeBlock code={visibleText} language={language} codePlugin={codePlugin} />
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 ml-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? t('chat.toolBlock.collapse') : t('chat.toolBlock.moreLines', { count: hiddenCount })}
        </button>
      )}
    </div>
  )
}

/** Prettified JSON code block with syntax highlighting and truncation. */
export function PrettyJSONCodeBlock({ text }: { text: string }) {
  const jsonResult = useMemo(() => tryPrettifyJson(text), [text])
  return (
    <TruncatedCodeBlock code={jsonResult ?? text} language={jsonResult ? 'json' : 'text'} />
  )
}

/** Renders an AskUserQuestion option preview — sanitized HTML or markdown. Shared by the live prompt and the answered result. */
export function QuestionPreviewContent({ content, format }: { content: string; format: QuestionPreviewFormat }) {
  const html = useMemo(
    () => (format === 'html' ? DOMPurify.sanitize(content, { USE_PROFILES: { html: true } }) : ''),
    [content, format],
  )
  if (format === 'html') {
    return <div className="ask-html-preview" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <Streamdown
      className="github-md"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      components={streamdownComponents}
      controls={streamdownControls}
      linkSafety={streamdownLinkSafety}
    >
      {content}
    </Streamdown>
  )
}

/** Render AskUserQuestion result as Q&A pairs, with the selected option's preview shown inline when available. */
export function AskUserQuestionResult({ text, params }: { text: string; params: Record<string, unknown> }) {
  return (
    <AskUserQuestionResultPresenter
      text={text}
      params={params}
      renderPreview={(preview) => <QuestionPreviewContent {...preview} />}
    />
  )
}
