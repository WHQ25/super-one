import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpenText, FileText, Folder, Search, Terminal } from 'lucide-react'
import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'
import { codexCommandPresentation, type CodexCommandKind } from '@superone/shared/codex-command-actions'
import { isCodexCommandToolError } from '@superone/shared/codex-command-status'
import { ToolName, ToolRow, ToolSummary } from './ToolRow'
import { ToolOperationDetails } from './ToolOperationDetails'
import { TerminalCommandOutput } from './TerminalCommandOutput'

const icons = { read: FileText, search: Search, list: Folder, explore: BookOpenText, bash: Terminal }
const labels = { read: 'Read', search: 'Grep', list: 'LS', explore: '', bash: 'Bash' }

export function CodexCommandBlockPresenter({ item, isStreaming, cwd, renderFileChip, renderAnsiText, detailStatus,
  expanded: controlledExpanded, onExpandedChange }: {
  item: CodexCommandExecutionItem
  isStreaming: boolean
  cwd?: string
  renderFileChip: (path: string) => ReactNode
  renderAnsiText: (text: string) => ReactNode
  detailStatus?: ReactNode
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const { t } = useTranslation()
  const view = codexCommandPresentation(item, cwd)
  const [internalExpanded, setInternalExpanded] = useState(false)
  const expanded = controlledExpanded ?? internalExpanded
  const realRunning = item.status === 'in_progress'
  const [showRunning, setShowRunning] = useState(realRunning)
  useEffect(() => {
    if (realRunning) { setShowRunning(true); return }
    const timer = setTimeout(() => setShowRunning(false), 500)
    return () => clearTimeout(timer)
  }, [realRunning])
  const running = isStreaming && showRunning
  const error = isCodexCommandToolError(item)
  const tone = error ? 'error' : 'default'
  const [outputOpen, setOutputOpen] = useState(error)
  const Icon = icons[view.kind]
  const multi = view.kind !== 'bash' && view.actions.length > 1
  const label = view.kind === 'explore' ? t(running ? 'chat.codex.exploringCode' : 'chat.codex.codeExplored')
    : running ? `${t(view.kind === 'read' ? 'chat.codex.statusReading' : view.kind === 'search' ? 'chat.codex.statusSearching' : 'chat.codex.statusRunning')}…`
    : labels[view.kind]
  const output = `${item.aggregatedOutput}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim()
  const outputPanel = <>
    <TerminalCommandOutput command={item.command} hasOutput={!!output} outputVersion={output}>
      {output ? <div className="text-terminal-muted">{renderAnsiText(output)}</div>
        : running ? <div className="text-terminal-muted animate-shimmer">{t('chat.codex.runningInline')}</div> : null}
    </TerminalCommandOutput>
  </>
  const details = multi ? <>{detailStatus}<ToolOperationDetails outputOpen={outputOpen} onOutputOpenChange={setOutputOpen} outputPanel={outputPanel}>
    {view.actions.map((action, index) => {
      const kind: CodexCommandKind = action.type === 'read' ? 'read' : action.type === 'search' ? 'search' : 'list'
      const ActionIcon = icons[kind]
      return <div key={index} className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-xs">
        <ActionIcon className="size-3 shrink-0 text-muted-foreground" />
        <ToolName>{labels[kind]}</ToolName>
        {kind === 'read' && action.path ? renderFileChip(action.path)
          : <ToolSummary>{[action.query, action.path].filter(Boolean).join(' in ') || action.command}</ToolSummary>}
      </div>
    })}
  </ToolOperationDetails></> : <>{detailStatus}{outputPanel}</>
  const first = view.actions[0]
  return <ToolRow icon={<Icon className="size-3 shrink-0 text-muted-foreground" />} tone={tone} expandable
    details={details} detailsClassName="" mountDetails="expanded" expanded={expanded}
    onExpandedChange={next => { setInternalExpanded(next); onExpandedChange?.(next) }}>
    <ToolName streaming={running} tone={tone}>{label}</ToolName>
    {view.kind === 'read' && view.files.length === 1 ? renderFileChip(view.files[0]!)
      : view.files.length > 1 && view.kind !== 'bash' ? <ToolSummary>{t('chat.toolBlock.nativeCode.fileCount', { count: view.files.length })}</ToolSummary>
      : !expanded ? <ToolSummary>{view.kind === 'bash' ? item.command : [first?.query, first?.path].filter(Boolean).join(' in ') || item.command}</ToolSummary> : null}
  </ToolRow>
}
