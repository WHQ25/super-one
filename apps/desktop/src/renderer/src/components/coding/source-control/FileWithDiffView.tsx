import { useMemo, useRef } from 'react'
import { DiffView, buildFullFileWithDiff, reconstructOldContent, useHighlightedTokens, inferLanguage } from '@/lib/diff-utils'
import { CodeMinimap } from '@/components/coding/CodeMinimap'
import { useSourceControlStore } from '@/stores/source-control'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useEffectiveProjectRoot } from '@/stores/app'

interface FileWithDiffViewProps {
  filePath: string
  content: string
  diff: string
}

export function FileWithDiffView({ filePath, content, diff }: FileWithDiffViewProps) {
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollToLine = useSourceControlStore((s) => s.scrollToLine)
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFullFileWithDiff(content, diff), [content, diff])
  const oldContent = useMemo(() => reconstructOldContent(content, diff), [content, diff])
  const fileRoot = useEffectiveProjectRoot()
  const cache = useMemo(() => getHighlightCache(fileRoot), [fileRoot])
  const newTokens = useHighlightedTokens(content, language, { cache })
  const oldTokens = useHighlightedTokens(oldContent, language, { cache })

  return (
    <div className="flex h-full">
      <DiffView ref={scrollRef} lines={lines} newTokens={newTokens} oldTokens={oldTokens} fontSize={14} maxHeight="max-h-full" className="min-h-full flex-1 text-sm" hideScrollbar scrollToLine={scrollToLine} />
      <CodeMinimap lines={lines} tokens={newTokens} scrollRef={scrollRef} />
    </div>
  )
}
