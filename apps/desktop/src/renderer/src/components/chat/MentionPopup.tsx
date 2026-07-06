import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Bot, Folder } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { useChatStore, useActiveSession, type MentionKind } from '@/stores/chat'
import { useEffectiveProjectRoot } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useTranslation } from 'react-i18next'
import type { ListDirEntry, MentionSearchItem } from '@superone/shared/agent-types'
import { groupItems, PopupSectionHeader } from './popup-groups'

export interface MentionPopupHandle {
  confirmTab: () => void
  confirmEnter: () => void
  getItemCount: () => number
}

interface MentionPopupProps {
  query: string
  selectedIndex: number
  onSelect: (value: string, action: 'navigate' | 'select', kind?: MentionKind, displayName?: string) => void
  onSetSelectedIndex: (index: number) => void
  onClose: () => void
  onResultState?: (query: string, isEmpty: boolean) => void
  showAgents?: boolean
}

type FlatItem =
  | { kind: 'file'; path: string; displayPath: string; isDirectory: boolean; matchIndices: number[] }
  | { kind: 'dir-entry'; entry: ListDirEntry; prefix: string }
  | { kind: 'agent'; name: string; model: string; matchIndices: number[] }
  | { kind: 'miniapp'; appId: string; displayName: string; matchIndices: number[] }

function fuzzyMatchIndices(text: string, query: string): number[] | null {
  if (!query) return []
  const tLow = text.toLowerCase()
  const qLow = query.toLowerCase()
  const idx = tLow.indexOf(qLow)
  if (idx < 0) return null
  const indices: number[] = []
  for (let i = 0; i < qLow.length; i++) indices.push(idx + i)
  return indices
}

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
  if (item.kind === 'file') return item.isDirectory ? item.path + '/' : item.path
  if (item.kind === 'agent') return item.name
  if (item.kind === 'miniapp') return item.appId
  return ''
}

const MENTION_GROUP_ORDER = ['agent', 'miniapp', 'file'] as const

function mentionGroupKey(item: FlatItem): string {
  if (item.kind === 'agent') return 'agent'
  if (item.kind === 'miniapp') return 'miniapp'
  return 'file'
}

export const MentionPopup = forwardRef<MentionPopupHandle, MentionPopupProps>(
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, onResultState, showAgents = true }, ref) {
    const { t } = useTranslation()
    const activeProject = useChatStore((s) => s.activeProject)
    const fileRoot = useEffectiveProjectRoot()
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
        if (!fileRoot) { setSearchCompleted(true); return }
        window.agent.listDirectory(fileRoot, query)
          .then((entries) => { setDirEntries(entries); setSearchCompleted(true) })
          .catch(() => { setDirEntries([]); setSearchCompleted(true) })
        return
      }

      debounceRef.current = setTimeout(() => {
        if (!fileRoot) { setSearchCompleted(true); return }
        const searchQuery = scopeDir ? query.slice(scopeDir.length) : query
        window.agent.searchMentions(fileRoot, searchQuery, agentEntries, additionalDirs, scopeDir)
          .then((results) => { setSearchResults(results); setSearchCompleted(true) })
          .catch(() => { setSearchResults([]); setSearchCompleted(true) })
      }, 150)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, fileRoot, additionalDirs, agentEntries, isBrowseMode, scopeDir])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    const miniApps = useMiniAppStore((s) => s.apps)
    const matchedMiniApps = useMemo<FlatItem[]>(() => {
      if (!miniApps || miniApps.length === 0) return []
      if (isBrowseMode && query) return []
      const matches: FlatItem[] = []
      for (const app of miniApps) {
        const name = app.manifest.name
        const idMatch = fuzzyMatchIndices(app.id, query)
        const nameMatch = fuzzyMatchIndices(name, query)
        if (idMatch === null && nameMatch === null) continue
        matches.push({
          kind: 'miniapp',
          appId: app.id,
          displayName: name,
          matchIndices: nameMatch ?? [],
        })
      }
      return matches
    }, [miniApps, query, isBrowseMode])

    const flatItems: FlatItem[] = useMemo(() => {
      if (isBrowseMode) {
        const items: FlatItem[] = [...matchedMiniApps]
        for (const entry of dirEntries) items.push({ kind: 'dir-entry', entry, prefix: browseDir })
        if (!query) {
          for (const a of agentEntries) {
            items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [] })
          }
        }
        return items
      }

      const prefixLen = scopeDir?.length ?? 0
      const items: FlatItem[] = [...matchedMiniApps]
      for (const item of searchResults) {
        if (item.kind === 'agent') {
          items.push({ kind: 'agent', name: item.name, model: item.model, matchIndices: item.matchIndices })
        } else {
          const displayPath = scopeDir ? item.path.slice(prefixLen) : item.path
          const displayIndices = scopeDir ? item.matchIndices.map((i) => i - prefixLen).filter((i) => i >= 0) : item.matchIndices
          items.push({ kind: 'file', path: item.path, displayPath, isDirectory: item.isDirectory, matchIndices: displayIndices })
        }
      }
      return items
    }, [isBrowseMode, browseDir, query, searchResults, dirEntries, agentEntries, scopeDir, matchedMiniApps])

    const mentionGroups = useMemo(
      () => groupItems(flatItems, mentionGroupKey, MENTION_GROUP_ORDER),
      [flatItems]
    )
    const orderedItems = useMemo(() => mentionGroups.flatMap((g) => g.items), [mentionGroups])

    useEffect(() => {
      if (!searchCompleted) return
      onResultState?.(query, orderedItems.length === 0)
    }, [searchCompleted, orderedItems.length, query, onResultState])

    const handleItemClick = useCallback(
      (item: FlatItem, action: 'navigate' | 'select') => {
        if (action === 'navigate' && isDirItem(item)) {
          onSelect(getNavigatePath(item), 'navigate')
        } else if (item.kind === 'miniapp') {
          onSelect(item.appId, 'select', 'miniapp', item.displayName)
        } else {
          onSelect(getSelectPath(item), 'select')
        }
      },
      [onSelect]
    )

    const getSelectedItem = useCallback(() => {
      if (orderedItems.length === 0) return null
      const idx = Math.max(0, Math.min(selectedIndex, orderedItems.length - 1))
      return orderedItems[idx]
    }, [orderedItems, selectedIndex])

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
        getItemCount: () => orderedItems.length,
      }),
      [getSelectedItem, handleItemClick, orderedItems.length]
    )

    const activeScopeDir = isBrowseMode ? browseDir : scopeDir
    const breadcrumbs = activeScopeDir ? activeScopeDir.split('/').filter(Boolean) : []
    const projectName = activeProject?.split('/').pop() || ''

    const groupLabel = (key: string): string => {
      if (key === 'agent') return t('chat.mentionPopup.groupAgents')
      if (key === 'miniapp') return t('chat.mentionPopup.groupMiniApps')
      return t('chat.mentionPopup.groupFiles')
    }

    const setItemRef = (i: number) => (el: HTMLButtonElement | null) => {
      if (el) itemRefs.current.set(i, el)
      else itemRefs.current.delete(i)
    }

    const renderItem = (item: FlatItem, i: number) => {
      const rowClass = cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
        i === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/40'
      )
      if (item.kind === 'miniapp') {
        return (
          <button
            key={`m-${item.appId}`}
            ref={setItemRef(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item.appId, 'select', 'miniapp', item.displayName)}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            <MiniAppIcon appId={item.appId} className="size-3.5 shrink-0" />
            <span className="shrink-0 font-medium">
              <HighlightedPath path={item.displayName} indices={item.matchIndices} />
            </span>
          </button>
        )
      }
      if (item.kind === 'agent') {
        return (
          <button
            key={`a-${item.name}`}
            ref={setItemRef(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item.name, 'select')}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={cn(rowClass, 'gap-1.5')}
          >
            <Bot className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0">
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
            ref={setItemRef(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleItemClick(item, item.isDirectory ? 'navigate' : 'select')}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            {item.isDirectory ? (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
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
          ref={setItemRef(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleItemClick(item, item.entry.isDirectory ? 'navigate' : 'select')}
          onMouseEnter={() => onSetSelectedIndex(i)}
          className={rowClass}
        >
          {item.entry.isDirectory ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon name={item.entry.name} size={14} />
          )}
          <span className="truncate">{item.entry.name}</span>
        </button>
      )
    }

    if (searchCompleted && orderedItems.length === 0) return null

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-popover flex flex-col">
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

          {mentionGroups.map((group) => (
            <div key={group.key}>
              <PopupSectionHeader label={groupLabel(group.key)} count={group.items.length} />
              {group.items.map((item, j) => renderItem(item, group.startIndex + j))}
            </div>
          ))}
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
