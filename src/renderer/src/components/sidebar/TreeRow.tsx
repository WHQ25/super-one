import { useCallback, useRef, useEffect, useState, memo } from 'react'
import { ChevronRight, Pencil, FolderOpen, Trash2, Copy, AtSign } from 'lucide-react'
import { FileIcon, FolderIcon } from '@/components/ui/FileIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { chatInputAPI } from '@/components/chat/ChatInput'
import { useFileTreeStore, type VisibleItem } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
import type { GitFileStatus } from '../../../../shared/agent-types'

const STATUS_COLOR: Record<string, string> = {
  M: 'text-yellow-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
  C: 'text-blue-400',
  '?': 'text-sidebar-foreground/50',
  U: 'text-orange-400',
  '!': 'text-sidebar-foreground/30',
}

export function getStatusColor(status: GitFileStatus | null | undefined): string {
  if (!status) return 'text-sidebar-foreground'
  return STATUS_COLOR[status] ?? 'text-sidebar-foreground'
}

function InlineRenameInput({
  item,
  currentFolder,
}: {
  item: VisibleItem
  currentFolder: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const renameFile = useFileTreeStore((s) => s.renameFile)
  const setRenamingPath = useFileTreeStore((s) => s.setRenamingPath)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (!item.isDirectory) {
      const dotIndex = item.name.lastIndexOf('.')
      el.setSelectionRange(0, dotIndex > 0 ? dotIndex : item.name.length)
    } else {
      el.select()
    }
  }, [item.name, item.isDirectory])

  const commit = useCallback(() => {
    const val = inputRef.current?.value.trim()
    if (!val || val === item.name) {
      setRenamingPath(null)
      return
    }
    renameFile(currentFolder, item.path, val)
  }, [item.path, item.name, currentFolder, renameFile, setRenamingPath])

  return (
    <input
      ref={inputRef}
      defaultValue={item.name}
      className="min-w-0 flex-1 rounded-sm border border-primary/50 bg-sidebar px-1 text-[15px] text-sidebar-foreground outline-none"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setRenamingPath(null)
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export const TREE_DND_MIME = 'application/x-tree-path'
export const TREE_DND_DIR_MIME = 'application/x-tree-is-dir'

const EXPAND_HOVER_DELAY = 500
export const autoExpandedDirs = new Set<string>()

function createDragImage(name: string, button: HTMLElement): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:-9999px;display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:13px;max-width:160px;background:var(--sidebar-accent);color:var(--sidebar-foreground);border:1px solid var(--sidebar-border);'
  const iconEl = button.children[1]
  if (iconEl) {
    const cloned = iconEl.cloneNode(true) as HTMLElement
    cloned.style.flexShrink = '0'
    el.appendChild(cloned)
  }
  const text = document.createElement('span')
  text.textContent = name
  text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  el.appendChild(text)
  document.body.appendChild(el)
  return el
}

import { getDropAction, getTargetDir, isChildPath } from './drag-drop-utils'

export const TreeRow = memo(function TreeRow({
  item,
  currentFolder,
  isSelected,
  isRenaming,
  onDeleteRequest,
}: {
  item: VisibleItem
  currentFolder: string
  isSelected: boolean
  isRenaming: boolean
  onDeleteRequest: (item: VisibleItem) => void
}) {
  const toggleDir = useFileTreeStore((s) => s.toggleDir)
  const setRenamingPath = useFileTreeStore((s) => s.setRenamingPath)
  const moveFile = useFileTreeStore((s) => s.moveFile)
  const copyFilesIn = useFileTreeStore((s) => s.copyFilesIn)
  const moveFilesIn = useFileTreeStore((s) => s.moveFilesIn)
  const setDragOverPath = useFileTreeStore((s) => s.setDragOverPath)
  const colorClass = getStatusColor(item.gitStatus)

  const targetDir = getTargetDir(item.path, item.isDirectory)

  const [isDragging, setIsDragging] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const dragCounterRef = useRef(0)
  const isDraggingRef = useRef(false)
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragImageRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    return () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
      if (dragImageRef.current) dragImageRef.current.remove()
    }
  }, [])

  const handleClick = useCallback(() => {
    if (isRenaming) return
    if (item.isDirectory) {
      toggleDir(currentFolder, item.path)
    } else {
      useSourceControlStore.getState().selectFile(currentFolder, item.path)
      useAppStore.getState().setShowFilePanel(true)
      useAppStore.getState().setFilePanelView('file')
    }
  }, [item.path, item.isDirectory, currentFolder, toggleDir, isRenaming])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData(TREE_DND_MIME, item.path)
    e.dataTransfer.setData(TREE_DND_DIR_MIME, item.isDirectory ? '1' : '0')
    e.dataTransfer.effectAllowed = 'copyMove'

    const img = createDragImage(item.name, e.currentTarget as HTMLElement)
    dragImageRef.current = img
    e.dataTransfer.setDragImage(img, -10, -10)
    requestAnimationFrame(() => {
      img.remove()
      dragImageRef.current = null
    })

    isDraggingRef.current = true
    setIsDragging(true)
  }, [item.path, item.isDirectory, item.name])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    setIsDragging(false)
  }, [])

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }, [])

  const isAcceptedDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes(TREE_DND_MIME) || e.dataTransfer.types.includes('Files')
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isDraggingRef.current) return
    if (!isAcceptedDrag(e)) return
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setDragOverPath(targetDir)
      if (item.isDirectory) {
        setIsDropTarget(true)
        if (!item.isExpanded) {
          expandTimerRef.current = setTimeout(() => {
            autoExpandedDirs.add(item.path)
            toggleDir(currentFolder, item.path)
          }, EXPAND_HOVER_DELAY)
        }
      }
    }
  }, [item.isDirectory, item.isExpanded, item.path, targetDir, currentFolder, toggleDir, isAcceptedDrag, setDragOverPath])

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      if (item.isDirectory) {
        setIsDropTarget(false)
        clearExpandTimer()
      }
    }
  }, [item.isDirectory, clearExpandTimer])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return
    e.preventDefault()
    const isInternal = e.dataTransfer.types.includes(TREE_DND_MIME)
    e.dataTransfer.dropEffect = getDropAction(isInternal, e.altKey)
  }, [isAcceptedDrag])

  const handleDrop = useCallback((e: React.DragEvent) => {
    dragCounterRef.current = 0
    setDragOverPath(null)
    if (item.isDirectory) {
      setIsDropTarget(false)
      clearExpandTimer()
    }

    const srcPath = e.dataTransfer.getData(TREE_DND_MIME)
    if (srcPath) {
      e.preventDefault()
      e.stopPropagation()
      if (srcPath === targetDir || isChildPath(srcPath, targetDir)) return
      moveFile(currentFolder, srcPath, targetDir)
      return
    }

    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length) {
      e.preventDefault()
      e.stopPropagation()
      const paths: string[] = []
      for (const file of e.dataTransfer.files) {
        const p = window.app.getPathForFile(file)
        if (p) paths.push(p)
      }
      if (paths.length > 0) {
        const action = getDropAction(false, e.altKey)
        if (action === 'move') moveFilesIn(currentFolder, targetDir, paths)
        else copyFilesIn(currentFolder, targetDir, paths)
      }
    }
  }, [targetDir, item.isDirectory, currentFolder, moveFile, copyFilesIn, moveFilesIn, clearExpandTimer, setDragOverPath])

  const rowContent = (
    <button
      draggable={!isRenaming}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors hover:bg-sidebar-accent',
        !item.isDirectory && isSelected && 'bg-sidebar-accent',
        isDropTarget && 'bg-sidebar-accent',
        isDragging && 'opacity-40',
      )}
      style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
    >
      {item.isDirectory ? (
        <ChevronRight className={cn(
          'size-3.5 shrink-0 text-sidebar-foreground/70 transition-transform duration-150',
          item.isExpanded && 'rotate-90',
        )} />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {item.isDirectory ? <FolderIcon name={item.name} size={15} /> : <FileIcon name={item.name} size={15} />}
      {isRenaming ? (
        <InlineRenameInput item={item} currentFolder={currentFolder} />
      ) : (
        <span className={cn('min-w-0 truncate', colorClass)}>{item.name}</span>
      )}
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {rowContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setRenamingPath(item.path)}>
          <Pencil className="mr-2 size-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => {
          chatInputAPI.insertMention?.(
            item.isDirectory ? 'directory' : 'file',
            item.isDirectory ? `${item.path}/` : item.path,
            item.name,
          )
        }}>
          <AtSign className="mr-2 size-3.5" />
          Add to Chat
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(`${currentFolder}/${item.path}`)}>
          <Copy className="mr-2 size-3.5" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(item.path)}>
          <Copy className="mr-2 size-3.5" />
          Copy Relative Path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => window.app.showInFolder(currentFolder, item.path)}>
          <FolderOpen className="mr-2 size-3.5" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDeleteRequest(item)}
        >
          <Trash2 className="mr-2 size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}, (prev, next) =>
  prev.item.path === next.item.path &&
  prev.item.isExpanded === next.item.isExpanded &&
  prev.item.gitStatus === next.item.gitStatus &&
  prev.item.hasChildren === next.item.hasChildren &&
  prev.isSelected === next.isSelected &&
  prev.isRenaming === next.isRenaming &&
  prev.currentFolder === next.currentFolder
)
