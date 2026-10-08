import { useEffect, useMemo, useState } from 'react'
import { DiffView, inferLanguage, useHighlightedTokens, type DiffLine } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useEffectiveProjectRoot } from '@/stores/app'
import { parseDiffBody, type ParsedFilePrefix } from '@superone/shared/file-quote-prefix'
import { mergeQuoteTokens } from '@/lib/quote-tokens'
import { toProjectRelativePath } from '@/lib/file-link'

function useFullFileContent(filePath: string, fileRoot: string | null): string | null {
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => {
    if (!fileRoot || !filePath) return
    const relPath = toProjectRelativePath(filePath, fileRoot)
    // Outside the project root — nothing readable through readProjectFile.
    if (relPath === filePath) return
    let cancelled = false
    window.app.readProjectFile?.(fileRoot, relPath).then((r) => {
      if (!cancelled && r?.content != null) setContent(r.content)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [filePath, fileRoot])
  return content
}

/** A quoted file selection's code, highlighted against the whole file where the project can read it. */
export function QuoteCodeBody({ quote, lineNums }: { quote: ParsedFilePrefix; lineNums: number[] }) {
  const { body, filePath, isDiff } = quote
  const fileRoot = useEffectiveProjectRoot()
  const cache = useMemo(() => getHighlightCache(fileRoot), [fileRoot])
  const language = useMemo(() => inferLanguage(filePath), [filePath])

  const diffLines = useMemo(() => isDiff ? parseDiffBody(body) : null, [isDiff, body])
  const codeOnly = useMemo(
    () => diffLines ? diffLines.map((l) => l.text).join('\n') : body,
    [diffLines, body],
  )
  const hasRemoved = useMemo(
    () => diffLines ? diffLines.some((l) => l.kind === 'removed') : false,
    [diffLines],
  )

  const fullContent = useFullFileContent(filePath, fileRoot)
  const fullTokens = useHighlightedTokens(fullContent ?? '', language, { cache })
  const snippetTokens = useHighlightedTokens(
    hasRemoved || !fullTokens ? codeOnly : '',
    language,
    { cache },
  )

  const lines = useMemo<DiffLine[]>(() => {
    const codeLines = codeOnly.split('\n')
    return codeLines.map((text, i) => ({
      kind: diffLines?.[i]?.kind ?? 'unchanged',
      lineNum: lineNums[i] ?? i + 1,
      text,
      sourceIdx: i,
    }))
  }, [codeOnly, lineNums, diffLines])

  const tokens = useMemo(() => mergeQuoteTokens(lines, fullTokens, snippetTokens), [lines, fullTokens, snippetTokens])

  return <DiffView lines={lines} newTokens={tokens} oldTokens={tokens} maxHeight="max-h-64" className="text-xs" />
}
