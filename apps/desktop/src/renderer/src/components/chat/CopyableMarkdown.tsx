import { DesktopSessionLinkScope } from '@/lib/session-links'
import { SessionChip, sessionChipLabel } from '@superone/chat-view/presenters/SessionChip'
import { rehypeSessionLinks } from '@superone/chat-view/presenters/markdown-media'
import { memo, useMemo, type ComponentProps, type ComponentType } from 'react'
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

function SessionMarkdownLink({ href, children }: ComponentProps<'a'> & { node?: unknown }) {
  return <SessionChip href={href ?? ''} label={sessionChipLabel(children)} />
}

const desktopMarkdownRuntime: CopyableMarkdownRuntime = {
  components: { ...streamdownComponents, 'session-chip': SessionMarkdownLink } as unknown as Components,
  controls: streamdownControls,
  getMathPluginSync,
  linkSafety: streamdownLinkSafety,
  loadMathPlugin,
  plugins: streamdownPlugins,
  rehypePlugins: [...streamdownRehypePlugins, rehypeSessionLinks],
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
    <DesktopSessionLinkScope><InsightBlockPresenter
      title={title}
      content={content}
      isStreaming={isStreaming}
      runtime={desktopMarkdownRuntime}
    /></DesktopSessionLinkScope>
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
    <DesktopSessionLinkScope projectPath={projectPath}><CopyableMarkdownPresenter
      text={text}
      isStreaming={isStreaming}
      components={components as Components | undefined}
      runtime={runtime}
    /></DesktopSessionLinkScope>
  )
})
