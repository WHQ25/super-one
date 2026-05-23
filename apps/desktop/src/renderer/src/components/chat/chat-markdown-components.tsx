import { useRef } from 'react'
import { AtSign, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@superone/ui/components/ui/context-menu'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { chatInputAPI } from '@/components/chat/ChatInput'
import { toMentionPath } from '@/components/chat/chat-input-utils'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { useSourceControlStore } from '@/stores/source-control'
import { clickReleasedOnSelection, parseFileLinkTarget } from '@/lib/file-link'
import { buildDragImagePng, preloadDragIcons, loadIconFromSvgElement } from '@/components/sidebar/drag-image-builder'

preloadDragIcons()

export function InlineFileChip({ name, filePath, lineNumber }: { name: string; filePath: string; lineNumber?: number }) {
  const { t } = useTranslation()
  const dragEndRef = useRef(0)
  const dragIconRef = useRef<HTMLImageElement | null>(null)
  const relativeTo = (projectPath: string): string =>
    filePath.startsWith(projectPath + '/') ? filePath.slice(projectPath.length + 1) : filePath
  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const svg = e.currentTarget.querySelector('svg')
    if (svg) dragIconRef.current = loadIconFromSvgElement(svg)
  }
  const handleDragStart = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const dragImage = buildDragImagePng(name, false, dragIconRef.current)
    if (dragImage) window.app.startDrag([filePath], { png: dragImage.buffer, scaleFactor: dragImage.scaleFactor })
    else window.app.startDrag([filePath])
    const cleanup = (): void => {
      dragEndRef.current = Date.now()
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
  }
  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    if (!projectRoot) return
    const relative = relativeTo(projectRoot)
    useSourceControlStore.getState().selectFile(projectRoot, relative, lineNumber)
    openFileTab(relative)
  }
  const handleOpenFolder = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    if (!projectRoot) return
    window.app.showInFolder(projectRoot, relativeTo(projectRoot))
  }
  const handleAddToChat = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    chatInputAPI.insertMention?.('file', toMentionPath(filePath, projectRoot), name)
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          role="button"
          draggable
          onMouseDown={handleMouseDown}
          onDragStart={handleDragStart}
          onClick={handleClick}
          title={filePath}
          className="inline-flex cursor-pointer items-center gap-0.5 rounded bg-muted px-1 text-[0.9em] text-foreground whitespace-nowrap align-baseline translate-y-[1px] hover:bg-muted/80 transition-colors"
        >
          <FileIcon name={name} size={12} />
          <span>{name}</span>
          {lineNumber != null && <span className="text-muted-foreground text-[0.85em]">#L{lineNumber}</span>}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpen className="mr-2 size-3.5" />
          {t('sidebar.contextMenu.openFolder')}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleAddToChat}>
          <AtSign className="mr-2 size-3.5" />
          {t('sidebar.contextMenu.addToChat')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function FileLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href: rawHref, children, ...rest } = props
  const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
  const href = rawHref ? decodeURIComponent(rawHref) : rawHref
  if (href && projectRoot) {
    const { filePath, lineNumber } = parseFileLinkTarget(href)
    if (filePath.startsWith(projectRoot + '/')) {
      const name = filePath.split('/').pop() || ''
      return <InlineFileChip name={name} filePath={filePath} lineNumber={lineNumber} />
    }
  }
  return <a href={rawHref} {...rest}>{children}</a>
}

export const fileLinkComponents = { a: FileLink }
