import { useRef } from 'react'
import { FileChipShell } from '@superone/chat-view/presenters/FileChipShell'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { DraggableFileIcon } from './DraggableFileIcon'
import { useFileChipContextMenu } from './file-chip-context-menu'
import { useChatStore } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, formatLineRange, parseFileLinkTarget, toProjectRelativePath } from '@/lib/file-link'

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
  const dragEndRef = useRef(0)
  const menuItems = useFileChipContextMenu(targetPath, name)

  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    if (!targetPath) return
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = toProjectRelativePath(targetPath, projectPath)
    useSourceControlStore.getState().selectFile(projectPath, relative, targetLineNumber)
    openFileTab(relative)
  }

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

  if (menuItems.length === 0) return chip
  return <AdaptiveContextMenu items={menuItems}>{chip}</AdaptiveContextMenu>
}
