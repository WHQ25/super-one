import { useEffect, useCallback, useRef, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { FileIcon, FolderIcon } from '@/components/ui/FileIcon'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore, type VisibleItem } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
import type { GitFileStatus } from '../../../../shared/agent-types'

const STATUS_COLOR: Record<string, string> = {
  M: 'text-yellow-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
  '?': 'text-sidebar-foreground/50',
  U: 'text-orange-400',
  '!': 'text-sidebar-foreground/30',
}

function getStatusColor(status: GitFileStatus | null | undefined): string {
  if (!status) return 'text-sidebar-foreground'
  return STATUS_COLOR[status] ?? 'text-sidebar-foreground'
}

const TreeRow = memo(function TreeRow({
  item,
  currentFolder,
  isSelected,
}: {
  item: VisibleItem
  currentFolder: string
  isSelected: boolean
}) {
  const toggleDir = useFileTreeStore((s) => s.toggleDir)
  const colorClass = getStatusColor(item.gitStatus)

  const handleClick = useCallback(() => {
    if (item.isDirectory) {
      toggleDir(currentFolder, item.path)
    } else {
      useSourceControlStore.getState().selectFile(currentFolder, item.path)
      useAppStore.getState().setShowFilePanel(true)
      useAppStore.getState().setFilePanelView('file')
    }
  }, [item.path, item.isDirectory, currentFolder, toggleDir])

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors hover:bg-sidebar-accent',
        !item.isDirectory && isSelected && 'bg-sidebar-accent',
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
      <span className={cn('min-w-0 truncate', colorClass)}>{item.name}</span>
    </button>
  )
}, (prev, next) =>
  prev.item.path === next.item.path &&
  prev.item.isExpanded === next.item.isExpanded &&
  prev.item.gitStatus === next.item.gitStatus &&
  prev.item.hasChildren === next.item.hasChildren &&
  prev.isSelected === next.isSelected &&
  prev.currentFolder === next.currentFolder
)

export function FileTree() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const loading = useFileTreeStore((s) => s.loading)
  const visibleList = useFileTreeStore((s) => s._visibleList)
  const visibleVersion = useFileTreeStore((s) => s._visibleVersion)
  const fetchTree = useFileTreeStore((s) => s.fetchTree)
  const selectedFile = useSourceControlStore((s) => s.selectedFile)
  const folderName = currentFolder?.split('/').pop() ?? 'Project'

  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: visibleList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 10,
    getItemKey: (index) => visibleList[index]?.path ?? index,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [visibleVersion, virtualizer])

  useEffect(() => {
    if (currentFolder) fetchTree(currentFolder)
  }, [currentFolder, fetchTree])

  const isEmpty = visibleList.length === 0 && !loading

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-1.5">
        <span className="text-xs font-medium text-sidebar-foreground/70">{folderName}</span>
      </div>

      <div className="min-h-0 flex-1">
        {isEmpty ? (
          <div className="flex items-center justify-center p-4 text-xs text-sidebar-foreground/50">
            No files
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-auto">
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
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
                      currentFolder={currentFolder!}
                      isSelected={selectedFile === item.path}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
