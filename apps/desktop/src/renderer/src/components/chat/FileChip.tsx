import { useRef } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { DraggableFileIcon } from './DraggableFileIcon'
import { useFileChipContextMenu } from './file-chip-context-menu'
import { useChatStore } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, parseFileLinkTarget, toProjectRelativePath } from '@/lib/file-link'

export function FileChip({ name, title, filePath, lineNumber, className }: {
  name: string
  title: string
  filePath?: string
  lineNumber?: number
  className?: string
}) {
  const parsed = filePath ? parseFileLinkTarget(filePath) : null
  const targetPath = parsed?.filePath
  const targetLineNumber = lineNumber ?? parsed?.lineNumber
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
    <span
      role="button"
      onClick={handleClick}
      title={title}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground hover:bg-muted/80 transition-colors"
    >
      <DraggableFileIcon name={name} filePath={targetPath} dragEndRef={dragEndRef} className="shrink-0" />
      <span className={cn('truncate', className)}>{name}</span>
      {targetLineNumber != null && <span className="text-muted-foreground text-xs">#L{targetLineNumber}</span>}
    </span>
  )

  if (menuItems.length === 0) return chip
  return <AdaptiveContextMenu items={menuItems}>{chip}</AdaptiveContextMenu>
}
