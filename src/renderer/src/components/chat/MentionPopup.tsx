import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chat'
import type { AgentInfo, ListDirEntry } from '../../../../shared/agent-types'

export interface MentionPopupHandle {
  /** Confirm the currently selected item (called on Enter/Tab) */
  confirmSelection: () => void
  /** Get current item count */
  getItemCount: () => number
}

interface MentionPopupProps {
  query: string
  selectedIndex: number
  onSelect: (value: string) => void
  onSetSelectedIndex: (index: number) => void
  onClose: () => void
}

type FlatItem =
  | { kind: 'file'; entry: ListDirEntry }
  | { kind: 'agent'; agent: AgentInfo }

export const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, onClose }, ref) {
    const agents = useChatStore((s) => s.agents)
    const [dirEntries, setDirEntries] = useState<ListDirEntry[]>([])
    const [currentPath, setCurrentPath] = useState('')
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const { dirPath, filter } = parseMentionQuery(query)

    // Fetch directory contents when dirPath changes
    useEffect(() => {
      const pathToList = dirPath || ''
      setCurrentPath(pathToList)
      window.agent.listDirectory(pathToList).then(setDirEntries).catch(() => setDirEntries([]))
    }, [dirPath])

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
      (entry: ListDirEntry) => {
        const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
        if (entry.isDirectory) {
          onSelect(fullPath + '/')
        } else {
          onSelect(fullPath)
        }
      },
      [currentPath, onSelect]
    )

    // Expose imperative methods for parent keyboard handling
    useImperativeHandle(
      ref,
      () => ({
        confirmSelection: () => {
          if (flatItems.length === 0) return
          const idx = Math.max(0, Math.min(selectedIndex, flatItems.length - 1))
          const item = flatItems[idx]
          if (item.kind === 'file') {
            handleFileClick(item.entry)
          } else {
            onSelect(item.agent.name)
          }
        },
        getItemCount: () => flatItems.length,
      }),
      [selectedIndex, flatItems, handleFileClick, onSelect]
    )

    const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

    // Find where agents section starts (for the section header)
    const agentStartIdx = filteredFiles.length

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-0.5 max-h-72 overflow-hidden rounded-t-lg border border-neutral-700 bg-neutral-800 flex flex-col">
        {/* Content */}
        <div className="overflow-y-auto p-1 flex-1 min-h-0">
          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-neutral-500">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect('')}
                className="hover:text-neutral-300"
              >
                root
              </button>
              {breadcrumbs.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <span>/</span>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(breadcrumbs.slice(0, i + 1).join('/') + '/')}
                    className="hover:text-neutral-300"
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Files section */}
          {filteredFiles.length > 0 && filteredAgents.length > 0 && (
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase text-neutral-500">
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
              onClick={() => handleFileClick(entry)}
              onMouseEnter={() => onSetSelectedIndex(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                i === selectedIndex
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-300 hover:bg-neutral-700/50'
              )}
            >
              <span className="shrink-0 text-neutral-500">
                {entry.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
              </span>
              <span className="truncate">{entry.name}</span>
            </button>
          ))}

          {/* Agents section */}
          {filteredAgents.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase text-neutral-500">
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
                    onClick={() => onSelect(agent.name)}
                    onMouseEnter={() => onSetSelectedIndex(flatIdx)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors',
                      flatIdx === selectedIndex
                        ? 'bg-neutral-700 text-white'
                        : 'text-neutral-300 hover:bg-neutral-700/50'
                    )}
                  >
                    <span className="font-medium text-purple-400 truncate">@{agent.name}</span>
                    <span className="shrink-0 rounded bg-neutral-700/60 px-1 py-px text-[10px] text-neutral-500">
                      agent
                    </span>
                    {agent.description && (
                      <span className="text-neutral-500 truncate">{agent.description}</span>
                    )}
                  </button>
                )
              })}
            </>
          )}

          {flatItems.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-neutral-500">No matches</div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 shrink-0">
          <kbd className="rounded bg-neutral-700 px-1">Tab</kbd>/<kbd className="rounded bg-neutral-700 px-1">Enter</kbd> select
          <span className="mx-1.5">&middot;</span>
          <kbd className="rounded bg-neutral-700 px-1">&uarr;&darr;</kbd> navigate
          <span className="mx-1.5">&middot;</span>
          <kbd className="rounded bg-neutral-700 px-1">Esc</kbd> close
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
