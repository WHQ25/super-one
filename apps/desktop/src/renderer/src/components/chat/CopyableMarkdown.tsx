import { memo, useMemo, type ComponentType } from 'react'
import { defaultRemarkPlugins, type Components } from 'streamdown'
import { remarkMediaPaths } from './remark-media-paths'
import { tryCopy } from '@/lib/clipboard'
import {
  getMathPluginSync,
  loadMathPlugin,
  streamdownComponents,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from './chat-shared'
import {
  CopyableMarkdownPresenter,
  InsightBlockPresenter,
  type CopyableMarkdownRuntime,
} from './presenters/CopyableMarkdown'

export {
  normalizeCodeFences,
  splitByCodeFences,
  splitByInsightBlocks,
} from './presenters/CopyableMarkdown'

const desktopMarkdownRuntime: CopyableMarkdownRuntime = {
  components: streamdownComponents,
  controls: streamdownControls,
  getMathPluginSync,
  linkSafety: streamdownLinkSafety,
  loadMathPlugin,
  plugins: streamdownPlugins,
  rehypePlugins: streamdownRehypePlugins,
  copyText: tryCopy,
}

/**
 * Insight callout for a pre-split `insight` block. Desktop chat keeps the `★ … ───`
 * markers inside the turn's text and lets `CopyableMarkdownPresenter` split them, so
 * this only runs on a transcript that arrived already split — a session replayed from
 * a remote node. Same card either way: both paths mount `InsightBlockPresenter`.
 */
export const InsightBlock = memo(function InsightBlock({
  title,
  content,
  isStreaming,
}: {
  title: string
  content: string
  isStreaming: boolean
}) {
  return (
    <InsightBlockPresenter
      title={title}
      content={content}
      isStreaming={isStreaming}
      runtime={desktopMarkdownRuntime}
    />
  )
})

export interface CopyableMarkdownProps {
  text: string
  projectPath?: string | null
  isStreaming: boolean
  components?: Record<string, ComponentType<never>>
}

export const CopyableMarkdown = memo(function CopyableMarkdown({
  text,
  isStreaming,
  components,
  projectPath,
}: CopyableMarkdownProps) {
  const runtime = useMemo(() => projectPath ? {
    ...desktopMarkdownRuntime,
    remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkMediaPaths(projectPath)],
  } : desktopMarkdownRuntime, [projectPath])
  return (
    <CopyableMarkdownPresenter
      text={text}
      isStreaming={isStreaming}
      components={components as Components | undefined}
      runtime={runtime}
    />
  )
})
