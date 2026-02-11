import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Folder } from 'lucide-react'
import { FileIcon } from '@/components/ui/FileIcon'
import { cn } from '@/lib/utils'
import { useChatStore, useActiveSession } from '@/stores/chat'
import type { AgentInfo, ListDirEntry } from '../../../../shared/agent-types'

export interface MentionPopupHandle {
  /** Tab: directory → navigate into; file/agent → select */
  confirmTab: () => void
  /** Enter: always select (directory also selected directly) */
  confirmEnter: () => void
  /** Get current item count */
  getItemCount: () => number
}

interface MentionPopupProps {
  query: string
  selectedIndex: number
  onSelect: (value: string, action: 'navigate' | 'select') => void
  onSetSelectedIndex: (index: number) => void
  onClose: () => void
  rounded?: boolean
}

type FlatItem =
  | { kind: 'file'; entry: ListDirEntry }
  | { kind: 'agent'; agent: AgentInfo }

export const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, onClose, rounded }, ref) {
    const activeProject = useChatStore((s) => s.activeProject)
    const agents = useActiveSession((s) => s.agents)
    const [dirEntries, setDirEntries] = useState<ListDirEntry[]>([])
    const [currentPath, setCurrentPath] = useState('')
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const { dirPath, filter } = parseMentionQuery(query)

    // Fetch directory contents when dirPath changes
    useEffect(() => {
      const pathToList = dirPath || ''
      setCurrentPath(pathToList)
      if (!activeProject) return
      window.agent.listDirectory(activeProject, pathToList).then(setDirEntries).catch(() => setDirEntries([]))
    }, [dirPath, activeProject])

    // Scroll selected into view
    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    // Filter files
    const filteredFiles = filter
      ? dirEntries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
      : dirEntries

    // Filter agents (only when not navigating into a subdirectory)
    const filteredAgents = dirPath
      ? [] // Inside a subdirectory — don't show agents
      : filter
        ? agents.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
        : agents

    // Build flat item list: files first, then agents
    const flatItems: FlatItem[] = [
      ...filteredFiles.map((entry): FlatItem => ({ kind: 'file', entry })),
      ...filteredAgents.map((agent): FlatItem => ({ kind: 'agent', agent })),
    ]

    const handleFileClick = useCallback(
      (entry: ListDirEntry, action: 'navigate' | 'select') => {
        const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
        if (entry.isDirectory) {
          onSelect(fullPath + '/', action)
        } else {
          onSelect(fullPath, 'select')
        }
      },
      [currentPath, onSelect]
    )

    const getSelectedItem = useCallback(() => {
      if (flatItems.length === 0) return null
      const idx = Math.max(0, Math.min(selectedIndex, flatItems.length - 1))
      return flatItems[idx]
    }, [flatItems, selectedIndex])

    // Expose imperative methods for parent keyboard handling
    useImperativeHandle(
      ref,
      () => ({
        confirmTab: () => {
          const item = getSelectedItem()
          if (!item) return
          if (item.kind === 'file') {
            // Directory → navigate into; file → select
            handleFileClick(item.entry, item.entry.isDirectory ? 'navigate' : 'select')
          } else {
            onSelect(item.agent.name, 'select')
          }
        },
        confirmEnter: () => {
          const item = getSelectedItem()
          if (!item) return
          if (item.kind === 'file') {
            handleFileClick(item.entry, 'select')
          } else {
            onSelect(item.agent.name, 'select')
          }
        },
        getItemCount: () => flatItems.length,
      }),
      [getSelectedItem, handleFileClick, onSelect]
    )

    const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

    // Find where agents section starts (for the section header)
    const agentStartIdx = filteredFiles.length

    return (
      <div className={cn("absolute bottom-full left-0 right-0 z-10 max-h-72 overflow-hidden border border-border bg-card flex flex-col", rounded ? 'mb-1 rounded-xl' : 'mb-0.5 rounded-t-lg')}>
        {/* Content */}
        <div className="overflow-y-auto p-1 flex-1 min-h-0">
          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-muted-foreground">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect('', 'navigate')}
                className="hover:text-foreground"
              >
                root
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

          {/* Files section */}
          {filteredFiles.length > 0 && filteredAgents.length > 0 && (
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              Files
            </div>
          )}
          {filteredFiles.map((entry, i) => (
            <button
              key={`f-${entry.name}`}
              ref={(el) => {
                if (el) itemRefs.current.set(i, el)
                else itemRefs.current.delete(i)
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleFileClick(entry, entry.isDirectory ? 'navigate' : 'select')}
              onMouseEnter={() => onSetSelectedIndex(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                i === selectedIndex
                  ? 'bg-muted text-foreground'
                  : 'text-foreground hover:bg-muted/50'
              )}
            >
              {entry.isDirectory ? (
                <Folder className="size-3.5 shrink-0 text-blue-500" />
              ) : (
                <FileIcon name={entry.name} size={14} />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          ))}

          {/* Agents section */}
          {filteredAgents.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                Agents
              </div>
              {filteredAgents.map((agent, ai) => {
                const flatIdx = agentStartIdx + ai
                return (
                  <button
                    key={`a-${agent.name}`}
                    ref={(el) => {
                      if (el) itemRefs.current.set(flatIdx, el)
                      else itemRefs.current.delete(flatIdx)
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(agent.name, 'select')}
                    onMouseEnter={() => onSetSelectedIndex(flatIdx)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors',
                      flatIdx === selectedIndex
                        ? 'bg-muted text-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    )}
                  >
                    <span className="font-medium text-purple-400 truncate">@{agent.name}</span>
                    <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] text-muted-foreground">
                      agent
                    </span>
                    {agent.description && (
                      <span className="text-muted-foreground truncate">{agent.description}</span>
                    )}
                  </button>
                )
              })}
            </>
          )}

          {flatItems.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground shrink-0">
          <kbd className="rounded bg-muted px-1">Tab</kbd> autocomplete
          <span className="mx-1.5">&middot;</span>
          <kbd className="rounded bg-muted px-1">Enter</kbd> select
          <span className="mx-1.5">&middot;</span>
          <kbd className="rounded bg-muted px-1">&uarr;&darr;</kbd> navigate
          <span className="mx-1.5">&middot;</span>
          <kbd className="rounded bg-muted px-1">Esc</kbd> close
        </div>
      </div>
    )
  }
)

function parseMentionQuery(query: string): { dirPath: string; filter: string } {
  if (!query) return { dirPath: '', filter: '' }
  const lastSlash = query.lastIndexOf('/')
  if (lastSlash === -1) return { dirPath: '', filter: query }
  return {
    dirPath: query.slice(0, lastSlash) || '',
    filter: query.slice(lastSlash + 1),
  }
}
