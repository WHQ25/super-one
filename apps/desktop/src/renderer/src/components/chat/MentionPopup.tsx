import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Bot, Folder } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { useChatStore, useActiveSession } from '@/stores/chat'
import type { ListDirEntry, MentionSearchItem } from '@superone/shared/agent-types'

export interface MentionPopupHandle {
  confirmTab: () => void
  confirmEnter: () => void
  getItemCount: () => number
}

interface MentionPopupProps {
  query: string
  selectedIndex: number
  onSelect: (value: string, action: 'navigate' | 'select') => void
  onSetSelectedIndex: (index: number) => void
  onClose: () => void
  showAgents?: boolean
}

type FlatItem =
  | { kind: 'file'; path: string; displayPath: string; isDirectory: boolean; matchIndices: number[] }
  | { kind: 'dir-entry'; entry: ListDirEntry; prefix: string }
  | { kind: 'agent'; name: string; model: string; matchIndices: number[] }

function HighlightedPath({ path, indices }: { path: string; indices: number[] }) {
  return <HighlightedText text={path} indices={indices} className="truncate" />
}

function isDirItem(item: FlatItem): boolean {
  if (item.kind === 'dir-entry') return item.entry.isDirectory
  if (item.kind === 'file') return item.isDirectory
  return false
}

function getNavigatePath(item: FlatItem): string {
  if (item.kind === 'dir-entry') return item.prefix + item.entry.name + '/'
  if (item.kind === 'file') return item.path + '/'
  return ''
}

function getSelectPath(item: FlatItem): string {
  if (item.kind === 'dir-entry') {
    const name = item.entry.isDirectory ? item.entry.name + '/' : item.entry.name
    return item.prefix + name
  }
  if (item.kind === 'file') return item.path
  if (item.kind === 'agent') return item.name
  return ''
}

export const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, showAgents = true }, ref) {
    const activeProject = useChatStore((s) => s.activeProject)
    const agents = useActiveSession((s) => s.agents)
    const additionalDirs = useActiveSession((s) => s.additionalDirs)
    const [dirEntries, setDirEntries] = useState<ListDirEntry[]>([])
    const [searchResults, setSearchResults] = useState<MentionSearchItem[]>([])
    const [searchCompleted, setSearchCompleted] = useState(false)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const agentEntries = useMemo(
      () => showAgents ? agents.map((a) => ({ name: a.name, model: a.model || '' })) : [],
      [agents, showAgents]
    )

    const isBrowseMode = !query || query.endsWith('/')
    const browseDir = isBrowseMode ? query : ''
    const lastSlash = query.lastIndexOf('/')
    const scopeDir = !isBrowseMode && lastSlash >= 0 ? query.slice(0, lastSlash + 1) : undefined

    useEffect(() => {
      setSearchCompleted(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)

      if (isBrowseMode) {
        setSearchResults([])
        if (!activeProject) { setSearchCompleted(true); return }
        window.agent.listDirectory(activeProject, query)
          .then((entries) => { setDirEntries(entries); setSearchCompleted(true) })
          .catch(() => { setDirEntries([]); setSearchCompleted(true) })
        return
      }

      debounceRef.current = setTimeout(() => {
        if (!activeProject) { setSearchCompleted(true); return }
        const searchQuery = scopeDir ? query.slice(scopeDir.length) : query
        window.agent.searchMentions(activeProject, searchQuery, agentEntries, additionalDirs, scopeDir)
          .then((results) => { setSearchResults(results); setSearchCompleted(true) })
          .catch(() => { setSearchResults([]); setSearchCompleted(true) })
      }, 150)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, activeProject, additionalDirs, agentEntries, isBrowseMode, scopeDir])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    const flatItems: FlatItem[] = useMemo(() => {
      if (isBrowseMode) {
        const items: FlatItem[] = dirEntries.map((entry): FlatItem => ({ kind: 'dir-entry', entry, prefix: browseDir }))
        if (!query) {
          for (const a of agentEntries) {
            items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [] })
          }
        }
        return items
      }

      const prefixLen = scopeDir?.length ?? 0
      return searchResults.map((item): FlatItem => {
        if (item.kind === 'agent') {
          return { kind: 'agent', name: item.name, model: item.model, matchIndices: item.matchIndices }
        }
        const displayPath = scopeDir ? item.path.slice(prefixLen) : item.path
        const displayIndices = scopeDir ? item.matchIndices.map((i) => i - prefixLen).filter((i) => i >= 0) : item.matchIndices
        return { kind: 'file', path: item.path, displayPath, isDirectory: item.isDirectory, matchIndices: displayIndices }
      })
    }, [isBrowseMode, browseDir, query, searchResults, dirEntries, agentEntries, scopeDir])

    const handleItemClick = useCallback(
      (item: FlatItem, action: 'navigate' | 'select') => {
        if (action === 'navigate' && isDirItem(item)) {
          onSelect(getNavigatePath(item), 'navigate')
        } else {
          onSelect(getSelectPath(item), 'select')
        }
      },
      [onSelect]
    )

    const getSelectedItem = useCallback(() => {
      if (flatItems.length === 0) return null
      const idx = Math.max(0, Math.min(selectedIndex, flatItems.length - 1))
      return flatItems[idx]
    }, [flatItems, selectedIndex])

    useImperativeHandle(
      ref,
      () => ({
        confirmTab: () => {
          const item = getSelectedItem()
          if (!item) return
          handleItemClick(item, isDirItem(item) ? 'navigate' : 'select')
        },
        confirmEnter: () => {
          const item = getSelectedItem()
          if (!item) return
          handleItemClick(item, 'select')
        },
        getItemCount: () => flatItems.length,
      }),
      [getSelectedItem, handleItemClick, flatItems.length]
    )

    const activeScopeDir = isBrowseMode ? browseDir : scopeDir
    const breadcrumbs = activeScopeDir ? activeScopeDir.split('/').filter(Boolean) : []
    const projectName = activeProject?.split('/').pop() || ''

    if (searchCompleted && flatItems.length === 0) return null

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-card flex flex-col">
        <div className="overflow-y-auto p-1 flex-1 min-h-0">
          {(breadcrumbs.length > 0 || (isBrowseMode && projectName)) && (
            <div className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-muted-foreground">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect('', 'navigate')}
                className="hover:text-foreground"
              >
                {projectName}
              </button>
              {breadcrumbs.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <span>/</span>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(breadcrumbs.slice(0, i + 1).join('/') + '/', 'navigate')}
                    className="hover:text-foreground"
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
          )}

          {flatItems.map((item, i) => {
            if (item.kind === 'agent') {
              return (
                <button
                  key={`a-${item.name}`}
                  ref={(el) => {
                    if (el) itemRefs.current.set(i, el)
                    else itemRefs.current.delete(i)
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(item.name, 'select')}
                  onMouseEnter={() => onSetSelectedIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    i === selectedIndex
                      ? 'bg-muted text-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  )}
                >
                  <Bot className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
                  <span className="shrink-0 font-medium text-purple-600 dark:text-purple-400">
                    <HighlightedPath path={item.name} indices={item.matchIndices} />
                  </span>
                  <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] text-muted-foreground">
                    {item.model || 'inherit'}
                  </span>
                </button>
              )
            }

            if (item.kind === 'file') {
              const fileName = item.displayPath.split('/').pop() || item.displayPath
              return (
                <button
                  key={`s-${item.path}`}
                  ref={(el) => {
                    if (el) itemRefs.current.set(i, el)
                    else itemRefs.current.delete(i)
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleItemClick(item, item.isDirectory ? 'navigate' : 'select')}
                  onMouseEnter={() => onSetSelectedIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    i === selectedIndex
                      ? 'bg-muted text-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  )}
                >
                  {item.isDirectory ? (
                    <Folder className="size-3.5 shrink-0 text-blue-500" />
                  ) : (
                    <FileIcon name={fileName} size={14} />
                  )}
                  <HighlightedPath path={item.displayPath} indices={item.matchIndices} />
                </button>
              )
            }

            return (
              <button
                key={`f-${item.prefix}${item.entry.name}`}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el)
                  else itemRefs.current.delete(i)
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleItemClick(item, item.entry.isDirectory ? 'navigate' : 'select')}
                onMouseEnter={() => onSetSelectedIndex(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                  i === selectedIndex
                    ? 'bg-muted text-foreground'
                    : 'text-foreground hover:bg-muted/50'
                )}
              >
                {item.entry.isDirectory ? (
                  <Folder className="size-3.5 shrink-0 text-blue-500" />
                ) : (
                  <FileIcon name={item.entry.name} size={14} />
                )}
                <span className="truncate">{item.entry.name}</span>
              </button>
            )
          })}
        </div>

        <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground shrink-0">
          <Kbd>tab</Kbd> autocomplete
          <span className="mx-1.5">&middot;</span>
          <Kbd>↵</Kbd> select
          <span className="mx-1.5">&middot;</span>
          <Kbd>↑↓</Kbd> navigate
          <span className="mx-1.5">&middot;</span>
          <Kbd>esc</Kbd> close
        </div>
      </div>
    )
  }
)
