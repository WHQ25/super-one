import { lazy, useMemo } from 'react'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { tryCopy } from '@/lib/clipboard'
import { useIsDark } from '@/hooks/use-is-dark'
import { codePluginLight } from './code-plugins'
import { highlightRhai, isRhaiLanguage } from './rhai-highlight'
import {
  HighlightedCodeBlockPresenter,
  createStreamdownCodeComponentPresenter,
  type HighlightedCodeBlockPresenterPorts,
  type HighlightResult,
  type StreamdownCodePresenterPorts,
} from './presenters/CodeBlock'

const MermaidBlock = lazy(() => import('./MermaidBlock').then((module) => ({ default: module.MermaidBlock })))

export { InlineCode } from './presenters/CodeBlock'

export interface HighlightedCodeBlockProps {
  code: string
  language: string
  codePlugin: CodeHighlighterPlugin
  isComplete?: boolean
}

function runRhaiHighlighter(
  code: string,
  themes: readonly unknown[],
  callback: (result: HighlightResult) => void,
): HighlightResult | null {
  return highlightRhai(
    code,
    themes as [string | { name?: string }, string | { name?: string }],
    callback,
  )
}

export function HighlightedCodeBlock(props: HighlightedCodeBlockProps) {
  const isDark = useIsDark()
  const ports = useMemo<HighlightedCodeBlockPresenterPorts>(() => ({
    isDark,
    lightCodePlugin: codePluginLight,
    copyText: tryCopy,
    isRhaiLanguage,
    highlightRhai: runRhaiHighlighter,
  }), [isDark])

  return <HighlightedCodeBlockPresenter {...props} ports={ports} />
}

const desktopStreamdownCodePorts: StreamdownCodePresenterPorts = {
  renderHighlightedCode: (props) => <HighlightedCodeBlock {...props} />,
  renderMermaid: (props) => <MermaidBlock {...props} />,
}

export function createStreamdownCodeComponent(codePlugin: CodeHighlighterPlugin) {
  return createStreamdownCodeComponentPresenter(codePlugin, desktopStreamdownCodePorts)
}
