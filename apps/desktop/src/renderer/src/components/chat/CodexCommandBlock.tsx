import { memo, useState, type ComponentProps } from 'react'
import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'
import { CodexCommandBlockPresenter } from '@superone/chat-view/presenters/CodexCommandBlock'
import { mergeCodexCommandDetail } from '@superone/chat-view/codex-command-detail'
import { DeferredDetailStatus, useDeferredToolDetail } from '@superone/chat-view/use-deferred-tool-detail'
import { useActiveSession } from '@/stores/chat'
import { AnsiText } from '@/lib/ansi'
import { FileChip } from './ToolBlock'
import { shortenPath } from './tool-display'

type CodexCommandBlockProps = { item: CodexCommandExecutionItem; isStreaming: boolean }

export const CodexCommandBlock = memo(function CodexCommandBlock(props: CodexCommandBlockProps) {
  return props.item.remoteDetail ? <DeferredCodexCommandBlock {...props} remoteDetail={props.item.remoteDetail} /> : <CodexCommandRow {...props} />
})

/** A summarized row from a remote machine: the output loads when the row opens. */
function DeferredCodexCommandBlock({ item, isStreaming, remoteDetail }: CodexCommandBlockProps & { remoteDetail: string }) {
  const [expanded, setExpanded] = useState(false)
  const { detail, status, retry } = useDeferredToolDetail(remoteDetail, expanded, item.status !== 'in_progress')
  return <CodexCommandRow item={mergeCodexCommandDetail(item, detail)} isStreaming={isStreaming}
    expanded={expanded} onExpandedChange={setExpanded}
    detailStatus={<DeferredDetailStatus status={status} onRetry={retry} />} />
}

function CodexCommandRow({ item, isStreaming, ...deferred }: CodexCommandBlockProps & Pick<ComponentProps<typeof CodexCommandBlockPresenter>, 'expanded' | 'onExpandedChange' | 'detailStatus'>) {
  const cwd = useActiveSession(s => s.cwd)
  const homedir = useActiveSession(s => s.homedir)
  return <CodexCommandBlockPresenter item={item} isStreaming={isStreaming} cwd={cwd} {...deferred}
    renderFileChip={path => <FileChip name={path.split(/[/\\]/).pop() || path} title={shortenPath(path, cwd, homedir)} filePath={path} />}
    renderAnsiText={text => <AnsiText text={text} />} />
}
