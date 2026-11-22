import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, MessageSquare, Search, X } from 'lucide-react'
import type { ReviewFileDiff, ReviewFileStatus } from '@superone/shared/review-types'
import { FileIcon, FolderIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'

interface ReviewFileSidebarProps {
  files: readonly ReviewFileDiff[]
  selectedPath: string | null
  commentCounts: ReadonlyMap<string, number>
  onSelect: (filePath: string) => void
  className?: string
}

type ReviewTreeRow =
  | { kind: 'dir'; path: string; name: string; depth: number; isExpanded: boolean }
  | { kind: 'file'; file: ReviewFileDiff; name: string; depth: number }

function statusStyle(status: ReviewFileStatus): { letter: string; className: string } {
  switch (status) {
    case 'added':
      return { letter: 'A', className: 'text-emerald-700 dark:text-emerald-400' }
    case 'deleted':
      return { letter: 'D', className: 'text-rose-700 dark:text-rose-400' }
    case 'renamed':
      return { letter: 'R', className: 'text-cyan-700 dark:text-cyan-400' }
    default:
      return { letter: 'M', className: 'text-amber-700 dark:text-amber-400' }
  }
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

function buildReviewTreeRows(
  files: readonly ReviewFileDiff[],
  collapsedDirs: ReadonlySet<string>,
  forceExpand: boolean,
): ReviewTreeRow[] {
  const fileByPath = new Map<string, ReviewFileDiff>()
  const dirSet = new Set<string>()

  for (const file of files) {
    fileByPath.set(file.path, file)
    const parts = file.path.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      dirSet.add(acc)
    }
  }

  const children = new Map<string, string[]>()
  const addChild = (parent: string, child: string) => {
    const list = children.get(parent)
    if (list) {
      if (!list.includes(child)) list.push(child)
    } else {
      children.set(parent, [child])
    }
  }

  for (const dir of dirSet) addChild(parentDirOf(dir), dir)
  for (const path of fileByPath.keys()) addChild(parentDirOf(path), path)

  for (const list of children.values()) {
    list.sort((a, b) => {
      const aDir = dirSet.has(a)
      const bDir = dirSet.has(b)
      if (aDir !== bDir) return aDir ? -1 : 1
      return basenameOf(a).localeCompare(basenameOf(b))
    })
  }

  const rows: ReviewTreeRow[] = []
  const walk = (parent: string, depth: number) => {
    const list = children.get(parent)
    if (!list) return
    for (const path of list) {
      if (dirSet.has(path)) {
        const isExpanded = forceExpand || !collapsedDirs.has(path)
        rows.push({ kind: 'dir', path, name: basenameOf(path), depth, isExpanded })
        if (isExpanded) walk(path, depth + 1)
      } else {
        const file = fileByPath.get(path)
        if (file) {
          rows.push({ kind: 'file', file, name: basenameOf(path), depth })
        }
      }
    }
  }

  walk('', 0)
  return rows
}

export const ReviewFileSidebar = memo(function ReviewFileSidebar({
  files,
  selectedPath,
  commentCounts,
  onSelect,
  className,
}: ReviewFileSidebarProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())

  const trimmedFilter = filter.trim().toLowerCase()
  const filteredFiles = useMemo(() => {
    if (!trimmedFilter) return files
    return files.filter((f) => f.path.toLowerCase().includes(trimmedFilter))
  }, [files, trimmedFilter])

  const treeRows = useMemo(
    () => buildReviewTreeRows(filteredFiles, collapsedDirs, Boolean(trimmedFilter)),
    [filteredFiles, collapsedDirs, trimmedFilter],
  )

  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  return (
    <div className={cn('flex h-full flex-col border-r border-border bg-transparent', className)}>
      <div className="flex items-center gap-1.5 border-b border-border/70 px-2 py-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('review.filterFiles')}
          className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear filter"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {treeRows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t('review.noFilesMatch')}
          </div>
        ) : (
          treeRows.map((row) => {
            if (row.kind === 'dir') {
              return (
                <button
                  key={`dir:${row.path}`}
                  type="button"
                  onClick={() => toggleDir(row.path)}
                  className="flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-muted/60"
                  style={{ paddingLeft: `${row.depth * 8 + 8}px` }}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                      row.isExpanded && 'rotate-90',
                    )}
                  />
                  <FolderIcon name={row.name} size={15} />
                  <span className="min-w-0 truncate">{row.name}</span>
                </button>
              )
            }

            const { file } = row
            const badge = statusStyle(file.status)
            const active = file.path === selectedPath
            const comments = commentCounts.get(file.path) ?? 0
            return (
              <button
                key={`file:${file.path}`}
                type="button"
                onClick={() => onSelect(file.path)}
                data-selected={active ? 'true' : undefined}
                className={cn(
                  'group flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[13px] transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-muted/60',
                )}
                style={{ paddingLeft: `${row.depth * 8 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <FileIcon name={row.name} size={15} className="shrink-0" />
                <span className={cn('min-w-0 flex-1 truncate', badge.className)}>{row.name}</span>
                <div className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                  {file.untracked && (
                    <span className="rounded bg-emerald-500/15 px-1 text-emerald-600 dark:text-emerald-400">
                      U
                    </span>
                  )}
                  {file.staged && (
                    <span className="rounded bg-sky-500/15 px-1 text-sky-600 dark:text-sky-400">
                      S
                    </span>
                  )}
                  {comments > 0 && (
                    <span className="flex items-center gap-0.5 text-primary">
                      <MessageSquare className="size-2.5" />
                      {comments}
                    </span>
                  )}
                  {file.additions > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
                  )}
                  <span className={cn('w-3 text-center font-semibold', badge.className)}>
                    {badge.letter}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
})
