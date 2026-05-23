import { useMemo } from 'react'
import {
  DiffView,
  buildUnifiedFileChangeDiffLines,
  reconstructOldContent,
  useHighlightedTokens,
  inferLanguage,
  type DiffLine,
} from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useEffectiveProjectRoot } from '@/stores/app'

interface FileDiffViewProps {
  filePath: string
  diff: string
  content: string
}

export function FileDiffView({ filePath, diff, content }: FileDiffViewProps) {
  if (!diff) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No diff available
      </div>
    )
  }

  return <DiffContent filePath={filePath} diff={diff} content={content} />
}

function DiffContent({ filePath, diff, content }: { filePath: string; diff: string; content: string }) {
  const language = inferLanguage(filePath)
  const lines = useMemo<DiffLine[]>(() => {
    const raw = buildUnifiedFileChangeDiffLines(diff)
    return raw.map((line) => ({ ...line, sourceIdx: line.lineNum - 1 }))
  }, [diff])
  const oldContent = useMemo(() => reconstructOldContent(content, diff), [content, diff])
  const fileRoot = useEffectiveProjectRoot()
  const cache = useMemo(() => getHighlightCache(fileRoot), [fileRoot])
  const newTokens = useHighlightedTokens(content, language, { cache })
  const oldTokens = useHighlightedTokens(oldContent, language, { cache })

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No diff available
      </div>
    )
  }

  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} fontSize={14} maxHeight="max-h-full" className="min-h-full text-sm" />
}
