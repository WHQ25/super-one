import { useCallback, useRef, useEffect, useState, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Pencil, FolderOpen, Trash2, Copy, AtSign } from 'lucide-react'
import { FileIcon, FolderIcon } from '@superone/ui/components/ui/FileIcon'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { cn } from '@superone/ui/lib/utils'
import { chatInputAPI } from '@/components/chat/ChatInput'
import { useFileTreeStore, type VisibleItem } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
import { openFileTab, openNewFileTab } from '@/components/activity/activity-panel-api'
import type { GitFileStatus } from '@superone/shared/agent-types'

const STATUS_COLOR: Record<GitFileStatus, string> = {
  M: 'text-amber-700 dark:text-amber-400',
  A: 'text-emerald-700 dark:text-emerald-400',
  D: 'text-rose-700 dark:text-rose-400',
  R: 'text-cyan-700 dark:text-cyan-400',
  C: 'text-cyan-700 dark:text-cyan-400',
  U: 'text-orange-700 dark:text-orange-400',
  '?': 'text-emerald-700 dark:text-emerald-400',
  '!': 'text-sidebar-foreground/50',
}

export function getStatusClass(
  index: GitFileStatus | null | undefined,
  worktree: GitFileStatus | null | undefined,
): string {
  if (index === '!' || worktree === '!') return STATUS_COLOR['!']

  const hasIndex = index != null
  const hasWorktree = worktree != null
  if (!hasIndex && !hasWorktree) return 'text-sidebar-foreground'

  const display = (hasIndex ? index : worktree) as GitFileStatus
  const base = STATUS_COLOR[display] ?? 'text-sidebar-foreground'

  if (hasIndex && hasWorktree) return `${base} italic`
  if (hasIndex) return base
  if (display === '?') return base
  return `${base} opacity-60`
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

const EXPAND_HOVER_DELAY = 500
export const autoExpandedDirs = new Set<string>()

import { getDropAction, getTargetDir, isChildPath, isWithinFolder, toAbsolutePath, internalDragSource } from './drag-drop-utils'
import { buildDragImagePng, preloadDragIcons, loadIconFromSvgElement } from './drag-image-builder'

preloadDragIcons()

export const TreeRow = memo(function TreeRow({
  item,
  currentFolder,
  isSelected,
  isRenaming,
  isRevealed,
  onDeleteRequest,
}: {
  item: VisibleItem
  currentFolder: string
  isSelected: boolean
  isRenaming: boolean
  isRevealed: boolean
  onDeleteRequest: (item: VisibleItem) => void
}) {
  const { t } = useTranslation()
  const toggleDir = useFileTreeStore((s) => s.toggleDir)
  const setRenamingPath = useFileTreeStore((s) => s.setRenamingPath)
  const copyFilesIn = useFileTreeStore((s) => s.copyFilesIn)
  const moveFilesIn = useFileTreeStore((s) => s.moveFilesIn)
  const setDragOverPath = useFileTreeStore((s) => s.setDragOverPath)
  const colorClass = getStatusClass(item.gitIndex, item.gitWorktree)

  const targetDir = getTargetDir(item.path, item.isDirectory)

  const [isDropTarget, setIsDropTarget] = useState(false)
  const dragCounterRef = useRef(0)
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragIconRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    return () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
    }
  }, [])

  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleClick = useCallback(() => {
    if (isRenaming) return
    if (Date.now() - internalDragSource.lastEndMs < 200) return
    if (item.isDirectory) {
      toggleDir(currentFolder, item.path)
      return
    }
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      useSourceControlStore.getState().selectFile(currentFolder, item.path)
      openFileTab(item.path)
    }, 200)
  }, [item.path, item.isDirectory, currentFolder, toggleDir, isRenaming])

  const handleDoubleClick = useCallback(() => {
    if (isRenaming || item.isDirectory) return
    clearTimeout(clickTimer.current)
    openNewFileTab(item.path)
  }, [item.path, item.isDirectory, isRenaming])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.currentTarget as HTMLElement
    const svgs = target.querySelectorAll<SVGElement>('svg')
    const iconSvg = item.isDirectory ? svgs[1] : svgs[0]
    if (iconSvg) dragIconRef.current = loadIconFromSvgElement(iconSvg)
  }, [item.isDirectory])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const absPath = toAbsolutePath(currentFolder, item.path)
    internalDragSource.active = true
    const cleanup = () => {
      internalDragSource.active = false
      internalDragSource.lastEndMs = Date.now()
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
    const dragImage = buildDragImagePng(item.name, item.isDirectory, dragIconRef.current)
    if (dragImage) {
      window.app.startDrag([absPath], { png: dragImage.buffer, scaleFactor: dragImage.scaleFactor })
    } else {
      window.app.startDrag([absPath])
    }
  }, [item.path, item.name, item.isDirectory, currentFolder])

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }, [])

  const isAcceptedDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('Files')
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
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
    e.dataTransfer.dropEffect = getDropAction(internalDragSource.active, e.altKey)
  }, [isAcceptedDrag])

  const handleDrop = useCallback((e: React.DragEvent) => {
    dragCounterRef.current = 0
    setDragOverPath(null)
    if (item.isDirectory) {
      setIsDropTarget(false)
      clearExpandTimer()
    }

    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    e.stopPropagation()

    const absTargetDir = toAbsolutePath(currentFolder, targetDir)
    const internalPaths: string[] = []
    const externalPaths: string[] = []
    for (const file of e.dataTransfer.files) {
      const p = window.app.getPathForFile(file)
      if (!p) continue
      if (isWithinFolder(p, currentFolder)) {
        if (p === absTargetDir || isChildPath(p, absTargetDir)) continue
        internalPaths.push(p)
      } else {
        externalPaths.push(p)
      }
    }

    if (internalPaths.length > 0) {
      moveFilesIn(currentFolder, targetDir, internalPaths)
    }
    if (externalPaths.length > 0) {
      const action = getDropAction(false, e.altKey)
      if (action === 'move') moveFilesIn(currentFolder, targetDir, externalPaths)
      else copyFilesIn(currentFolder, targetDir, externalPaths)
    }
  }, [targetDir, item.isDirectory, currentFolder, copyFilesIn, moveFilesIn, clearExpandTimer, setDragOverPath])

  const rowContent = (
    <button
      draggable={!isRenaming}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors hover:bg-sidebar-accent/80',
        !item.isDirectory && isSelected && 'bg-sidebar-accent',
        isDropTarget && 'bg-sidebar-accent',
        isRevealed && 'bg-sidebar-accent ring-1 ring-inset ring-primary/40',
      )}
      style={{ paddingLeft: `${item.depth * 8 + 8}px` }}
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

  const menuItems: AdaptiveMenuEntry[] = [
    { kind: 'item', id: 'rename', label: t('sidebar.contextMenu.rename'), icon: Pencil, onSelect: () => setRenamingPath(item.path) },
    { kind: 'item', id: 'addToChat', label: t('sidebar.contextMenu.addToChat'), icon: AtSign, onSelect: () => {
      chatInputAPI.insertMention?.(
        item.isDirectory ? 'directory' : 'file',
        item.isDirectory ? `${item.path}/` : item.path,
        item.name,
      )
    } },
    { kind: 'item', id: 'copyPath', label: t('sidebar.contextMenu.copyPath'), icon: Copy, onSelect: () => navigator.clipboard.writeText(`${currentFolder}/${item.path}`) },
    { kind: 'item', id: 'copyRelativePath', label: t('sidebar.contextMenu.copyRelativePath'), icon: Copy, onSelect: () => navigator.clipboard.writeText(item.path) },
    { kind: 'item', id: 'openFolder', label: t('sidebar.contextMenu.openFolder'), icon: FolderOpen, onSelect: () => window.app.showInFolder(currentFolder, item.path) },
    { kind: 'separator' },
    { kind: 'item', id: 'delete', label: t('sidebar.contextMenu.delete'), icon: Trash2, destructive: true, onSelect: () => onDeleteRequest(item) },
  ]

  return (
    <AdaptiveContextMenu items={menuItems}>
      {rowContent}
    </AdaptiveContextMenu>
  )
}, (prev, next) =>
  prev.item.path === next.item.path &&
  prev.item.isExpanded === next.item.isExpanded &&
  prev.item.gitIndex === next.item.gitIndex &&
  prev.item.gitWorktree === next.item.gitWorktree &&
  prev.item.hasChildren === next.item.hasChildren &&
  prev.isSelected === next.isSelected &&
  prev.isRenaming === next.isRenaming &&
  prev.isRevealed === next.isRevealed &&
  prev.currentFolder === next.currentFolder
)
