import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedCodeBlock } from './CodeBlock'
import { codePlugin } from './chat-shared'
import { tryPrettifyJson } from './tool-block-utils'

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
