import { memo } from 'react'
import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'
import { CodexCommandBlockPresenter } from '@superone/chat-view/presenters/CodexCommandBlock'
import { useActiveSession } from '@/stores/chat'
import { AnsiText } from '@/lib/ansi'
import { FileChip } from './ToolBlock'
import { shortenPath } from './tool-display'

export const CodexCommandBlock = memo(function CodexCommandBlock({ item, isStreaming }: { item: CodexCommandExecutionItem; isStreaming: boolean }) {
  const cwd = useActiveSession(s => s.cwd)
  const homedir = useActiveSession(s => s.homedir)
  return <CodexCommandBlockPresenter item={item} isStreaming={isStreaming} cwd={cwd}
    renderFileChip={path => <FileChip name={path.split(/[/\\]/).pop() || path} title={shortenPath(path, cwd, homedir)} filePath={path} />}
    renderAnsiText={text => <AnsiText text={text} />} />
})
