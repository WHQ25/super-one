import { lazy, useCallback, useMemo } from 'react'
import { projectSessionKey } from '@superone/shared/remote-resource-key'
import { useSessionScope } from '@/stores/chat-store/session-scope'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useTerminalStore } from '@/stores/terminal'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import { tryCopy } from '@/lib/clipboard'
import { useIsDark } from '@/hooks/use-is-dark'
import { codePluginLight } from './code-plugins'
import { useCodeBlockProject } from './code-block-project-scope'
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
  const scope = useSessionScope()
  const markdownProject = useCodeBlockProject()
  const activeProject = useChatStore(s => s.activeProject)
  const activeSessionId = useActiveSession(s => s._activeSessionId)
  const projectPath = scope?.projectPath ?? markdownProject ?? activeProject
  const sessionId = scope?.sessionId ?? activeSessionId
  const runBash = useCallback(async (bashScript: string) => {
    if (!projectPath) return
    // Omit sessionId: create resolves the project root, even when chat uses a worktree.
    const item = await window.terminal.create({ projectPath, title: 'Bash', bashScript })
    const terminal = useTerminalStore.getState()
    terminal.upsertTab(projectPath, item, true)
    terminal.setOpen(sessionId ? projectSessionKey(projectPath, sessionId) : null, true)
  }, [projectPath, sessionId])
  const ports = useMemo<HighlightedCodeBlockPresenterPorts>(() => ({
    isDark,
    lightCodePlugin: codePluginLight,
    copyText: tryCopy,
    isRhaiLanguage,
    highlightRhai: runRhaiHighlighter,
  }), [isDark])

  return <HighlightedCodeBlockPresenter {...props} ports={ports} runBash={projectPath ? runBash : null} />
}

const desktopStreamdownCodePorts: StreamdownCodePresenterPorts = {
  renderHighlightedCode: (props) => <HighlightedCodeBlock {...props} />,
  renderMermaid: (props) => <MermaidBlock {...props} />,
}

export function createStreamdownCodeComponent(codePlugin: CodeHighlighterPlugin) {
  return createStreamdownCodeComponentPresenter(codePlugin, desktopStreamdownCodePorts)
}
