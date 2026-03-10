import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Bot, Folder } from 'lucide-react'
import { FileIcon } from '@/components/ui/FileIcon'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { HighlightedText } from '@/components/ui/HighlightedText'
import { useChatStore, useActiveSession } from '@/stores/chat'
import type { ListDirEntry, MentionSearchItem } from '../../../../shared/agent-types'

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
  rounded?: boolean
}

type FlatItem =
  | { kind: 'file'; path: string; isDirectory: boolean; matchIndices: number[] }
  | { kind: 'dir-entry'; entry: ListDirEntry }
  | { kind: 'agent'; name: string; model: string; matchIndices: number[] }

function HighlightedPath({ path, indices }: { path: string; indices: number[] }) {
  return <HighlightedText text={path} indices={indices} className="truncate" />
}

export const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, showAgents = true, rounded }, ref) {
    const activeProject = useChatStore((s) => s.activeProject)
    const agents = useActiveSession((s) => s.agents)
    const additionalDirs = useActiveSession((s) => s.additionalDirs)
    const [dirEntries, setDirEntries] = useState<ListDirEntry[]>([])
    const [searchResults, setSearchResults] = useState<MentionSearchItem[]>([])
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const agentEntries = useMemo(
      () => showAgents ? agents.map((a) => ({ name: a.name, model: a.model || '' })) : [],
      [agents, showAgents]
    )

    useEffect(() => {
      if (query) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          if (!activeProject) return
          window.agent.searchMentions(activeProject, query, agentEntries, additionalDirs)
            .then(setSearchResults).catch(() => setSearchResults([]))
        }, 150)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
      }
      setSearchResults([])
      if (!activeProject) return
      window.agent.listDirectory(activeProject, '').then(setDirEntries).catch(() => setDirEntries([]))
    }, [query, activeProject, additionalDirs, agentEntries])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    const isSearchMode = !!query

    const flatItems: FlatItem[] = useMemo(() => {
      if (!isSearchMode) {
        const items: FlatItem[] = dirEntries.map((entry): FlatItem => ({ kind: 'dir-entry', entry }))
        for (const a of agentEntries) {
          items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [] })
        }
        return items
      }

      return searchResults.map((item): FlatItem => {
        if (item.kind === 'agent') {
          return { kind: 'agent', name: item.name, model: item.model, matchIndices: item.matchIndices }
        }
        return { kind: 'file', path: item.path, isDirectory: item.isDirectory, matchIndices: item.matchIndices }
      })
    }, [isSearchMode, searchResults, dirEntries, agentEntries])

    const handleItemClick = useCallback(
      (item: FlatItem) => {
        if (item.kind === 'file') {
          onSelect(item.path, 'select')
        } else if (item.kind === 'dir-entry') {
          onSelect(item.entry.isDirectory ? item.entry.name + '/' : item.entry.name, 'select')
        } else {
          onSelect(item.name, 'select')
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
          if (item) handleItemClick(item)
        },
        confirmEnter: () => {
          const item = getSelectedItem()
          if (item) handleItemClick(item)
        },
        getItemCount: () => flatItems.length,
      }),
      [getSelectedItem, handleItemClick, flatItems.length]
    )

    return (
      <div className={cn("absolute bottom-full left-0 right-0 z-10 max-h-72 overflow-hidden border border-border bg-card flex flex-col", rounded ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg')}>
        <div className="overflow-y-auto p-1 flex-1 min-h-0">
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
                  <Bot className="size-3.5 shrink-0 text-purple-400" />
                  <span className="shrink-0 font-medium text-purple-400">
                    <HighlightedPath path={item.name} indices={item.matchIndices} />
                  </span>
                  <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] text-muted-foreground">
                    {item.model || 'inherit'}
                  </span>
                </button>
              )
            }

            if (item.kind === 'file') {
              const fileName = item.path.split('/').pop() || item.path
              return (
                <button
                  key={`s-${item.path}`}
                  ref={(el) => {
                    if (el) itemRefs.current.set(i, el)
                    else itemRefs.current.delete(i)
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(item.path, 'select')}
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
                  <HighlightedPath path={item.path} indices={item.matchIndices} />
                </button>
              )
            }

            return (
              <button
                key={`f-${item.entry.name}`}
                ref={(el) => {
                  if (el) itemRefs.current.set(i, el)
                  else itemRefs.current.delete(i)
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(item.entry.isDirectory ? item.entry.name + '/' : item.entry.name, 'select')}
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

          {flatItems.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
          )}
        </div>

        <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground shrink-0">
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
