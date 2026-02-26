import { useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { FileIcon, FolderIcon } from '@/components/ui/FileIcon'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useExplorerStore } from '@/stores/explorer'
import { useSourceControlStore } from '@/stores/source-control'
import type { FileTreeEntry, GitFileStatus } from '../../../../shared/agent-types'

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

function TreeNode({ entry, depth }: { entry: FileTreeEntry; depth: number }) {
  const expandedDirs = useExplorerStore((s) => s.expandedDirs)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const loadingDirs = useExplorerStore((s) => s.loadingDirs)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const selectedFile = useSourceControlStore((s) => s.selectedFile)
  const isExpanded = expandedDirs.has(entry.path)
  const isLoading = loadingDirs.has(entry.path)
  const colorClass = getStatusColor(entry.gitStatus)

  const handleClick = useCallback(() => {
    if (entry.isDirectory && currentFolder) {
      toggleDir(currentFolder, entry.path)
    } else if (currentFolder) {
      useSourceControlStore.getState().selectFile(currentFolder, entry.path)
      useAppStore.getState().setShowFilePanel(true)
      useAppStore.getState().setFilePanelView('file')
    }
  }, [entry.path, entry.isDirectory, currentFolder, toggleDir])

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors hover:bg-sidebar-accent',
          !entry.isDirectory && selectedFile === entry.path && 'bg-sidebar-accent',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {entry.isDirectory ? (
          isLoading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-sidebar-foreground/50" />
          ) : (
            <ChevronRight className={cn(
              'size-3.5 shrink-0 text-sidebar-foreground/70 transition-transform duration-150',
              isExpanded && 'rotate-90'
            )} />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {entry.isDirectory ? <FolderIcon name={entry.name} size={15} /> : <FileIcon name={entry.name} size={15} />}
        <span className={cn('min-w-0 truncate', colorClass)}>{entry.name}</span>
      </button>

      {entry.isDirectory && (
        <AnimatePresence initial={false}>
          {isExpanded && entry.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              {entry.children.map((child) => (
                <TreeNode key={child.path} entry={child} depth={depth + 1} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  )
}

export function ExplorerTree() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const { tree, loading, fetchTree } = useExplorerStore()
  const folderName = currentFolder?.split('/').pop() ?? 'Project'

  useEffect(() => {
    if (currentFolder) fetchTree(currentFolder)
  }, [currentFolder, fetchTree])

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-1.5">
        <span className="text-xs font-medium text-sidebar-foreground/70">{folderName}</span>
      </div>

      <div className="min-h-0 flex-1">
        {tree.length === 0 && !loading ? (
          <div className="flex items-center justify-center p-4 text-xs text-sidebar-foreground/50">
            No files
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="pb-4">
              {tree.map((entry) => (
                <TreeNode key={entry.path} entry={entry} depth={0} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
