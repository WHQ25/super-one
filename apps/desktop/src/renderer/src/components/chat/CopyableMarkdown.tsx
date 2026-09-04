import { memo, type ComponentType } from 'react'
import type { Components } from 'streamdown'
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

export interface CopyableMarkdownProps {
  text: string
  isStreaming: boolean
  components?: Record<string, ComponentType<never>>
}

export const CopyableMarkdown = memo(function CopyableMarkdown({
  text,
  isStreaming,
  components,
}: CopyableMarkdownProps) {
  return (
    <CopyableMarkdownPresenter
      text={text}
      isStreaming={isStreaming}
      components={components as Components | undefined}
      runtime={desktopMarkdownRuntime}
    />
  )
})
