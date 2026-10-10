import { useContext, useState } from 'react'
import { DeferredDetailStatus, useDeferredToolDetail } from './use-deferred-tool-detail'
import { PortableFileChip } from './PortableToolRow'
import { mergeCodexCommandDetail } from './codex-command-detail'
import { PortableTurnContext } from './portable-turn-context'
import { AnsiText } from './presenters/ansi'
import { CodexCommandBlockPresenter } from './presenters/CodexCommandBlock'
import type { CodexCommandPresenterProps } from './presenters/CodexTurnView'

export function PortableCodexCommand({ item, isStreaming }: CodexCommandPresenterProps) {
  const { projectPath } = useContext(PortableTurnContext)
  const [expanded, setExpanded] = useState(false)
  const { detail, status, retry } = useDeferredToolDetail(item.remoteDetail, expanded, item.status !== 'in_progress')
  const loaded = mergeCodexCommandDetail(item, detail)
  return <div data-tool-use-id={item.id} className="min-w-0">
    <CodexCommandBlockPresenter item={loaded} isStreaming={isStreaming} cwd={projectPath ?? undefined}
      expanded={expanded} onExpandedChange={setExpanded}
      detailStatus={<DeferredDetailStatus status={status} onRetry={retry} />}
      renderFileChip={path => <PortableFileChip name={path.split(/[/\\]/).pop() || path} title={path} filePath={path} />}
      renderAnsiText={text => <AnsiText text={text} />} />
  </div>
}
