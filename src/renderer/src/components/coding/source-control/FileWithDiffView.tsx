import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { DiffView, buildFullFileWithDiff, useHighlightedTokens, inferLanguage } from '@/lib/diff-utils'

interface FileWithDiffViewProps {
  filePath: string
  content: string
  diff: string
  loading: boolean
}

export function FileWithDiffView({ filePath, content, diff, loading }: FileWithDiffViewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No content available
      </div>
    )
  }

  return <FileWithDiffContent filePath={filePath} content={content} diff={diff} />
}

function FileWithDiffContent({ filePath, content, diff }: { filePath: string; content: string; diff: string }) {
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFullFileWithDiff(content, diff), [content, diff])
  const tokens = useHighlightedTokens(content, language)

  return <DiffView lines={lines} newTokens={tokens} maxHeight="max-h-full" className="text-sm" />
}
