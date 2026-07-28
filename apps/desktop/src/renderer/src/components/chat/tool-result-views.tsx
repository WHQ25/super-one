import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Streamdown } from 'streamdown'
import DOMPurify from 'dompurify'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin, streamdownPlugins, streamdownRehypePlugins, streamdownControls, streamdownComponents, streamdownLinkSafety } from './chat-shared'
import { tryPrettifyJson, parseQAPairs } from './tool-block-utils'
import type { QuestionAnnotations, QuestionPreviewFormat, UserQuestion } from '@superone/shared/agent-types'

function SectionLabel({ children }: { children: string }) {
  return <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{children}</div>
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

/** Prettified JSON code block with syntax highlighting and truncation. */
export function PrettyJSONCodeBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  const jsonResult = useMemo(() => tryPrettifyJson(text), [text])
  const prettified = jsonResult ?? text
  const language = jsonResult ? 'json' : 'text'
  const lines = prettified.split('\n')
  const previewLines = 20
  const isLong = lines.length > previewLines
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - previewLines
  const visibleText = showAll || !isLong ? prettified : lines.slice(0, previewLines).join('\n')

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

interface AnsweredQuestion {
  question: string
  answer: string
  preview?: string
}

function extractAnsweredQuestions(params: Record<string, unknown>): AnsweredQuestion[] | null {
  const questions = params.questions
  const answers = params.answers
  if (!Array.isArray(questions) || typeof answers !== 'object' || answers === null) return null
  const annotations = (params.annotations && typeof params.annotations === 'object' ? params.annotations : {}) as QuestionAnnotations
  const answerMap = answers as Record<string, string>
  const result: AnsweredQuestion[] = []
  for (const q of questions as UserQuestion[]) {
    const answer = answerMap[q.question]
    if (!answer) continue
    result.push({ question: q.question, answer, preview: annotations[q.question]?.preview })
  }
  return result
}

/** Render AskUserQuestion result as Q&A pairs, with the selected option's preview shown inline when available. */
export function AskUserQuestionResult({ text, params }: { text: string; params: Record<string, unknown> }) {
  const previewFormat = (typeof params.previewFormat === 'string' ? params.previewFormat : 'markdown') as QuestionPreviewFormat
  const answered: AnsweredQuestion[] = extractAnsweredQuestions(params) ?? parseQAPairs(text)
  if (answered.length === 0) return null

  return (
    <div className="space-y-1">
      {answered.map((qa, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-xs leading-relaxed">
          <div className="text-muted-foreground">{qa.question}</div>
          <div className="text-success">{qa.answer}</div>
          {qa.preview && (
            <div
              className={cn(
                'mt-1.5 overflow-y-auto rounded-md border border-border/50 text-xs',
                previewFormat === 'html' ? 'max-h-[28rem] bg-transparent p-0' : 'max-h-64 bg-muted/30 p-2',
              )}
            >
              <QuestionPreviewContent content={qa.preview} format={previewFormat} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
