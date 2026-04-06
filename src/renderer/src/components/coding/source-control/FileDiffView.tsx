import { useMemo } from 'react'
import { DiffView, buildUnifiedFileChangeDiffLines, useHighlightedTokens, inferLanguage, type DiffLine } from '@/lib/diff-utils'

interface FileDiffViewProps {
  filePath: string
  diff: string
}

function buildDiffSourceText(lines: DiffLine[]): { oldText: string; newText: string } {
  const oldParts: string[] = []
  const newParts: string[] = []
  for (const line of lines) {
    if (line.kind !== 'added') oldParts.push(line.text)
    if (line.kind !== 'removed') newParts.push(line.text)
  }
  return { oldText: oldParts.join('\n'), newText: newParts.join('\n') }
}

export function FileDiffView({ filePath, diff }: FileDiffViewProps) {
  if (!diff) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No diff available
      </div>
    )
  }

  return <DiffContent filePath={filePath} diff={diff} />
}

function DiffContent({ filePath, diff }: { filePath: string; diff: string }) {
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildUnifiedFileChangeDiffLines(diff), [diff])
  const { oldText, newText } = useMemo(() => buildDiffSourceText(lines), [lines])
  const oldTokens = useHighlightedTokens(oldText, language)
  const newTokens = useHighlightedTokens(newText, language)

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No diff available
      </div>
    )
  }

  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} fontSize={14} maxHeight="max-h-full" className="min-h-full text-sm" />
}
