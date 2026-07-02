import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin } from './chat-shared'
import { tryPrettifyJson } from './tool-block-utils'

function SectionLabel({ children }: { children: string }) {
  return <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{children}</div>
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
          className="mt-0.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? t('chat.toolBlock.collapse') : t('chat.toolBlock.moreLines', { count: hiddenCount })}
        </button>
      )}
    </div>
  )
}
