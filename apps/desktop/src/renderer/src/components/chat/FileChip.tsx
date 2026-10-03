import { FileChipShell } from '@superone/chat-view/presenters/FileChipShell'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { DraggableFileIcon } from './DraggableFileIcon'
import { useFileChipActions } from './file-chip-context-menu'
import { formatLineRange, hasTextSelection, parseFileLinkTarget } from '@/lib/file-link'

export function FileChip({ name, title, filePath, lineNumber, endLine, className }: {
  name: string
  title: string
  filePath?: string
  lineNumber?: number
  endLine?: number
  className?: string
}) {
  const parsed = filePath ? parseFileLinkTarget(filePath) : null
  const targetPath = parsed?.filePath
  const targetLineNumber = lineNumber ?? parsed?.lineNumber
  const targetEndLine = lineNumber != null ? endLine : parsed?.endLine
  const { dragEndRef, menu, handleClick } = useFileChipActions(targetPath, targetLineNumber)

  const chip = (
    <FileChipShell
      icon={<DraggableFileIcon name={name} filePath={targetPath} dragEndRef={dragEndRef} className="shrink-0" />}
      name={name}
      title={title}
      lineRange={targetLineNumber != null ? formatLineRange(targetLineNumber, targetEndLine) : undefined}
      className={className}
      onClick={handleClick}
    />
  )

  if (menu.items.length === 0) return chip
  return <AdaptiveContextMenu items={menu.items} onOpen={menu.onOpen} yieldWhen={hasTextSelection}>{chip}</AdaptiveContextMenu>
}
