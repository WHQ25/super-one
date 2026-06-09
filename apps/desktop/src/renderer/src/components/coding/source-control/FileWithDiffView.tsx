import { useMemo, useRef, useState, useEffect } from 'react'
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

  const [overflowsPage, setOverflowsPage] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const node = scrollRef.current
        if (node) setOverflowsPage(node.scrollHeight - node.clientHeight > 1)
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [lines])

  return (
    <div className="flex h-full">
      <DiffView ref={scrollRef} lines={lines} newTokens={newTokens} oldTokens={oldTokens} fontSize={14} maxHeight="max-h-full" className="min-h-full flex-1 bg-transparent text-sm [--diff-gutter-bg:var(--card)]" hideScrollbar scrollToLine={scrollToLine} />
      {overflowsPage && <CodeMinimap lines={lines} tokens={newTokens} scrollRef={scrollRef} />}
    </div>
  )
}
