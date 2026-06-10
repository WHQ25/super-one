import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Search, X } from 'lucide-react'
import { FileIcon, FolderIcon } from '@superone/ui/components/ui/FileIcon'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { FileSearchResult } from '@superone/shared/agent-types'
import { useFileTreeStore } from '@/stores/file-tree'
import { useSourceControlStore } from '@/stores/source-control'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { buildSearchTree, type FlatSearchNode } from './file-search-tree'

const DEBOUNCE_MS = 150

export function FileTreeSearch({
  projectRoot,
  onClose,
}: {
  projectRoot: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const nodes = useMemo(() => buildSearchTree(results), [results])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearched(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      window.agent
        .searchFiles(projectRoot, q)
        .then((r) => {
          setResults(r)
          setSelectedIndex(0)
          setSearched(true)
        })
        .catch(() => {
          setResults([])
          setSearched(true)
        })
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, projectRoot])

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const activate = useCallback(
    (node: FlatSearchNode) => {
      if (node.isDirectory) {
        useFileTreeStore.getState().revealPath(projectRoot, node.path)
      } else {
        useSourceControlStore.getState().selectFile(projectRoot, node.path)
        openFileTab(node.path)
      }
      onClose()
    },
    [projectRoot, onClose],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, nodes.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const node = nodes[selectedIndex]
        if (node) activate(node)
      }
    },
    [nodes, selectedIndex, activate, onClose],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Search className="size-3.5 shrink-0 text-sidebar-foreground/50" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('sidebar.search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
        />
        <IconButton size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {searched && nodes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-sidebar-foreground/50">
            {t('sidebar.search.noResults')}
          </div>
        ) : (
          nodes.map((node, i) => (
            <button
              key={node.path}
              ref={(el) => {
                if (el) itemRefs.current.set(i, el)
                else itemRefs.current.delete(i)
              }}
              onClick={() => activate(node)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{ paddingLeft: `${node.depth * 8 + 8}px` }}
              className={cn(
                'flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[15px] transition-colors',
                i === selectedIndex
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
              )}
            >
              {node.isDirectory ? (
                <ChevronRight className="size-3.5 shrink-0 rotate-90 text-sidebar-foreground/70" />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {node.isDirectory ? (
                <FolderIcon name={node.name} size={15} />
              ) : (
                <FileIcon name={node.name} size={15} />
              )}
              <HighlightedText
                text={node.name}
                indices={node.matchIndices}
                className="min-w-0 truncate"
              />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
