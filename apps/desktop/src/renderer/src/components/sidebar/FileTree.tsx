import { useEffect, useCallback, useRef, useState, useMemo, type DragEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Search } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { projectDisplayName } from '@/lib/project-display-name'
import { useFileTreeStore, type VisibleItem } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { TreeRow, autoExpandedDirs } from './TreeRow'
import { FileTreeSearch } from './FileTreeSearch'
import { getDropAction, shouldCollapseAutoExpanded, computeDropOverlay, getDropTargetName, isWithinFolder, internalDragSource } from './drag-drop-utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'

const EDGE_SCROLL_ZONE = 40
const EDGE_SCROLL_SPEED = 8

function useAutoScroll(scrollRef: RefObject<HTMLDivElement | null>) {
  const rafRef = useRef(0)
  const speedRef = useRef(0)

  const tick = useCallback(() => {
    const el = scrollRef.current
    if (!el || speedRef.current === 0) return
    el.scrollTop += speedRef.current
    rafRef.current = requestAnimationFrame(tick)
  }, [scrollRef])

  const update = useCallback((clientY: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const top = clientY - rect.top
    const bottom = rect.bottom - clientY

    let speed = 0
    if (top < EDGE_SCROLL_ZONE) speed = -EDGE_SCROLL_SPEED
    else if (bottom < EDGE_SCROLL_ZONE) speed = EDGE_SCROLL_SPEED

    if (speed !== 0 && speedRef.current === 0) {
      speedRef.current = speed
      rafRef.current = requestAnimationFrame(tick)
    } else {
      speedRef.current = speed
    }
  }, [scrollRef, tick])

  const stop = useCallback(() => {
    speedRef.current = 0
    cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => () => { cancelAnimationFrame(rafRef.current) }, [])

  return { update, stop }
}

interface DeleteTarget {
  path: string
  name: string
  isDirectory: boolean
}

export function FileTree() {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const fileRoot = useEffectiveProjectRoot()
  const loading = useFileTreeStore((s) => s.loading)
  const visibleList = useFileTreeStore((s) => s._visibleList)
  const fetchTree = useFileTreeStore((s) => s.fetchTree)
  const refreshTree = useFileTreeStore((s) => s.refreshTree)
  const renamingPath = useFileTreeStore((s) => s.renamingPath)
  const toggleDir = useFileTreeStore((s) => s.toggleDir)
  const copyFilesIn = useFileTreeStore((s) => s.copyFilesIn)
  const moveFilesIn = useFileTreeStore((s) => s.moveFilesIn)
  const setDragOverPath = useFileTreeStore((s) => s.setDragOverPath)
  const dragOverPath = useFileTreeStore((s) => s.dragOverPath)
  const deleteFile = useFileTreeStore((s) => s.deleteFile)
  const revealedPath = useFileTreeStore((s) => s.revealedPath)
  const clearRevealed = useFileTreeStore((s) => s.clearRevealed)
  const selectedFile = useSourceControlStore((s) => s.selectedFile)
  // Registry name so a renamed project reads the same here as in the sidebar.
  const recentFolders = useAppStore((s) => s.recentFolders)
  const folderName = projectDisplayName(recentFolders, currentFolder) || 'Project'
  // Remote projects have no file watcher (fs.watch cannot follow a `remote:` key),
  // so the tree only refreshes when a turn ends — offer a manual refresh there.
  const isRemote = !!fileRoot && parseRemoteProjectKey(fileRoot) !== null

  const scrollRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [externalDragOver, setExternalDragOver] = useState(false)
  const [altKeyHeld, setAltKeyHeld] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const autoScroll = useAutoScroll(scrollRef)

  const virtualizer = useVirtualizer({
    count: visibleList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 10,
    getItemKey: (index) => visibleList[index]?.path ?? index,
  })

  useEffect(() => {
    window.app.trace?.('agent.store', 'FileTree:fetchTree', { currentFolder, fileRoot })
    if (fileRoot) fetchTree(fileRoot)
  }, [fileRoot, fetchTree])

  useEffect(() => {
    if (!fileRoot || autoExpandedDirs.size === 0) return
    for (const dir of autoExpandedDirs) {
      if (shouldCollapseAutoExpanded(dir, dragOverPath)) {
        toggleDir(fileRoot, dir)
        autoExpandedDirs.delete(dir)
      }
    }
  }, [dragOverPath, fileRoot, toggleDir])

  const resetDragState = useCallback(() => {
    setExternalDragOver(false)
    setAltKeyHeld(false)
    setDragOverPath(null)
    autoExpandedDirs.clear()
    autoScroll.stop()
  }, [setDragOverPath, autoScroll])

  useEffect(() => {
    document.addEventListener('mouseup', resetDragState)
    document.addEventListener('dragend', resetDragState)
    return () => {
      document.removeEventListener('mouseup', resetDragState)
      document.removeEventListener('dragend', resetDragState)
    }
  }, [resetDragState])

  // Rows unmount mid-drag (virtualizer scroll, auto-expand), so their pending `dragleave`
  // never fires and the tree can miss the pointer leaving. Watch the document instead:
  // any drag activity outside the drop zone — or a drag that left the window entirely —
  // retires the overlay.
  useEffect(() => {
    if (!externalDragOver) return
    const clearIfOutside = (e: globalThis.DragEvent) => {
      const node = e.target as Node | null
      if (node && dropZoneRef.current?.contains(node)) return
      resetDragState()
    }
    const clearIfLeftWindow = (e: globalThis.DragEvent) => {
      if (!e.relatedTarget) resetDragState()
    }
    document.addEventListener('dragover', clearIfOutside)
    document.addEventListener('drop', clearIfOutside)
    document.addEventListener('dragleave', clearIfLeftWindow)
    return () => {
      document.removeEventListener('dragover', clearIfOutside)
      document.removeEventListener('drop', clearIfOutside)
      document.removeEventListener('dragleave', clearIfLeftWindow)
    }
  }, [externalDragOver, resetDragState])

  useEffect(() => {
    setSearching(false)
  }, [fileRoot])

  useEffect(() => {
    if (!revealedPath) return
    const index = visibleList.findIndex((v) => v.path === revealedPath)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
    const timer = setTimeout(clearRevealed, 2000)
    return () => clearTimeout(timer)
  }, [revealedPath])

  const dropOverlay = useMemo(
    () => computeDropOverlay(dragOverPath, visibleList.map((v) => v.path), 28),
    [dragOverPath, visibleList],
  )

  const dropTargetName = useMemo(
    () => getDropTargetName(dragOverPath, folderName),
    [dragOverPath, folderName],
  )

  const isFileDrag = useCallback((e: DragEvent) => {
    return e.dataTransfer.types.includes('Files')
  }, [])

  const handleContainerDragEnter = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    if (!internalDragSource.active) setExternalDragOver(true)
  }, [isFileDrag])

  const handleContainerDragLeave = useCallback((e: DragEvent) => {
    if (!isFileDrag(e)) return
    // `dragleave` bubbles from every descendant; only the one that hands the pointer
    // to a node outside the tree (or out of the window, relatedTarget === null) counts.
    const next = e.relatedTarget as Node | null
    if (next && dropZoneRef.current?.contains(next)) return
    resetDragState()
  }, [isFileDrag, resetDragState])

  const handleContainerDragOver = useCallback((e: DragEvent) => {
    autoScroll.update(e.clientY)
    if (isFileDrag(e)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = getDropAction(internalDragSource.active, e.altKey)
      setAltKeyHeld(e.altKey)
    }
  }, [isFileDrag, autoScroll])

  const handleContainerDrop = useCallback((e: DragEvent) => {
    resetDragState()

    if (!fileRoot || !e.dataTransfer.files.length || e.defaultPrevented) return
    e.preventDefault()
    const internalPaths: string[] = []
    const externalPaths: string[] = []
    for (const file of e.dataTransfer.files) {
      const p = window.app.getPathForFile(file)
      if (!p) continue
      if (isWithinFolder(p, fileRoot)) internalPaths.push(p)
      else externalPaths.push(p)
    }
    if (internalPaths.length > 0) {
      moveFilesIn(fileRoot, '', internalPaths)
    }
    if (externalPaths.length > 0) {
      const action = getDropAction(false, e.altKey)
      if (action === 'move') moveFilesIn(fileRoot, '', externalPaths)
      else copyFilesIn(fileRoot, '', externalPaths)
    }
  }, [fileRoot, copyFilesIn, moveFilesIn, resetDragState])

  const handleDeleteRequest = useCallback((item: VisibleItem) => {
    setDeleteTarget({ path: item.path, name: item.name, isDirectory: item.isDirectory })
  }, [])

  const confirmDelete = useCallback(() => {
    if (!fileRoot || !deleteTarget) return
    deleteFile(fileRoot, deleteTarget.path)
    setDeleteTarget(null)
  }, [fileRoot, deleteTarget, deleteFile])

  const handleRefresh = useCallback(async () => {
    if (!fileRoot) return
    setRefreshing(true)
    try {
      await refreshTree(fileRoot)
    } finally {
      setRefreshing(false)
    }
  }, [fileRoot, refreshTree])

  const isEmpty = visibleList.length === 0 && !loading

  if (searching && fileRoot) {
    return <FileTreeSearch projectRoot={fileRoot} onClose={() => setSearching(false)} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-md font-medium text-sidebar-foreground/70">
          {folderName}
        </span>
        {isRemote && (
          <IconButton
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            tooltip={t('sidebar.refreshFiles')}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          </IconButton>
        )}
        {fileRoot && (
          <IconButton size="sm" onClick={() => setSearching(true)} tooltip={t('sidebar.search.placeholder')}>
            <Search />
          </IconButton>
        )}
      </div>

      <div
        ref={dropZoneRef}
        data-testid="file-tree-dropzone"
        className="relative min-h-0 flex-1"
        onDragEnter={handleContainerDragEnter}
        onDragLeave={handleContainerDragLeave}
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
      >
        {isEmpty ? (
          <div className="flex h-full items-center justify-center p-4 text-xs text-sidebar-foreground/50">
            {t('sidebar.noFiles')}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="h-full overflow-auto"
          >
            <div
              style={{ height: `${virtualizer.getTotalSize() + 40}px`, position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const item = visibleList[vRow.index]
                if (!item) return null
                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    <TreeRow
                      item={item}
                      currentFolder={fileRoot!}
                      isSelected={selectedFile === item.path}
                      isRenaming={renamingPath === item.path}
                      isRevealed={revealedPath === item.path}
                      onDeleteRequest={handleDeleteRequest}
                    />
                  </div>
                )
              })}

              {dropOverlay && (
                <div
                  className="pointer-events-none absolute left-0 right-0 rounded-sm border border-primary/40 bg-primary/5"
                  style={{ top: dropOverlay.top, height: dropOverlay.height }}
                />
              )}
            </div>

          </div>
        )}

        {externalDragOver && (
          <>
            {/* Outer ring says "this tree accepts the drop"; the row overlay above says
                *where* it lands. Keep this one flat — a filled/blurred mask here competes
                with the row highlight and reads as two stacked drop zones. */}
            <div className="pointer-events-none absolute inset-0 z-10 rounded-md border-2 border-dashed border-primary/40" />
            {/* `bg-primary`, NOT a sidebar surface token. `--sidebar-accent` is the vivid
                fill only in light mode; `.dark` redefines it to oklch(0.30 0 0), so the pill
                painted near-black on a near-black sidebar. `--primary` stays saturated at
                L 0.55 in both modes and is not remapped by the [data-sidebar-inner] scope,
                so it clears the ground either way — and matches the ring and row overlay. */}
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg">
              <span className="min-w-0 truncate font-medium">
                {altKeyHeld ? 'Move to' : 'Copy to'} {dropTargetName}
              </span>
              {!altKeyHeld && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap opacity-75">
                  Hold
                  <Kbd className="border border-current/40 bg-transparent text-inherit">
                    {navigator.platform.startsWith('Mac') ? 'option' : 'alt'}
                  </Kbd>
                  to move
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Trash</DialogTitle>
            <DialogDescription>
              Are you sure you want to move &quot;{deleteTarget?.name}&quot; to the trash?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
