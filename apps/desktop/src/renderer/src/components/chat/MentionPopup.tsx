import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Bot, Folder, Globe, MousePointer2, Users } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { useChatStore, useActiveSession, type MentionKind } from '@/stores/chat'
import { useEffectiveProjectRoot } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { isComputerUseSupportedPlatform } from '@/lib/computer-use-platform'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import { useTranslation } from 'react-i18next'
import type { ListDirEntry, MentionSearchItem } from '@superone/shared/agent-types'
import { BUILTIN_CAPABILITIES, type BuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
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
  | {
      kind: 'capability'
      id: BuiltinCapabilityId
      displayName: string
      matchIndices: number[]
      disabled?: boolean
    }
  | {
      kind: 'desktop-app'
      bundleId: string
      displayName: string
      matchIndices: number[]
    }

type InstalledDesktopApp = { app: string; bundleId: string; aliases: string[] }

const DESKTOP_APP_MENTION_LIMIT = 12

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
  if (item.kind === 'capability') return item.id
  if (item.kind === 'desktop-app') return item.bundleId
  return ''
}

const MENTION_GROUP_ORDER = ['capability', 'desktop-app', 'agent', 'miniapp', 'file'] as const

function mentionGroupKey(item: FlatItem): string {
  if (item.kind === 'capability') return 'capability'
  if (item.kind === 'desktop-app') return 'desktop-app'
  if (item.kind === 'agent') return 'agent'
  if (item.kind === 'miniapp') return 'miniapp'
  return 'file'
}

function capabilityIcon(id: BuiltinCapabilityId, disabled?: boolean) {
  const muted = disabled ? 'text-muted-foreground' : undefined
  if (id === 'collab') {
    return (
      <Users
        className={cn(
          'size-3.5 shrink-0',
          muted ?? 'text-violet-600 dark:text-violet-400',
        )}
      />
    )
  }
  if (id === 'computer') {
    return (
      <MousePointer2
        className={cn(
          'size-3.5 shrink-0',
          muted ?? 'text-emerald-600 dark:text-emerald-400',
        )}
      />
    )
  }
  return (
    <Globe
      className={cn(
        'size-3.5 shrink-0',
        muted ?? 'text-sky-600 dark:text-sky-400',
      )}
    />
  )
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
    // Only true when results were produced for `completedQuery` (guards empty-suppression races).
    const [searchCompleted, setSearchCompleted] = useState(false)
    const [completedQuery, setCompletedQuery] = useState<string | null>(null)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    // Bumps on every query/root change so in-flight listDirectory/searchMentions
    // responses from a previous keystroke cannot clobber newer state.
    const requestIdRef = useRef(0)

    const agentEntries = useMemo(
      () => showAgents ? agents.map((a) => ({ name: a.name, model: a.model || '' })) : [],
      [agents, showAgents]
    )

    const isBrowseMode = !query || query.endsWith('/')
    const browseDir = isBrowseMode ? query : ''
    const lastSlash = query.lastIndexOf('/')
    const scopeDir = !isBrowseMode && lastSlash >= 0 ? query.slice(0, lastSlash + 1) : undefined

    useEffect(() => {
      const requestId = ++requestIdRef.current
      setSearchCompleted(false)
      setCompletedQuery(null)
      if (debounceRef.current) clearTimeout(debounceRef.current)

      const finish = (forQuery: string, apply: () => void) => {
        if (requestId !== requestIdRef.current) return
        apply()
        setCompletedQuery(forQuery)
        setSearchCompleted(true)
      }

      if (isBrowseMode) {
        setSearchResults([])
        if (!fileRoot) {
          finish(query, () => setDirEntries([]))
          return
        }
        const browseQuery = query
        window.agent.listDirectory(fileRoot, browseQuery)
          .then((entries) => { finish(browseQuery, () => setDirEntries(entries)) })
          .catch(() => { finish(browseQuery, () => setDirEntries([])) })
        return
      }

      const searchForQuery = query
      const searchScope = scopeDir
      const searchNeedle = scopeDir ? query.slice(scopeDir.length) : query
      debounceRef.current = setTimeout(() => {
        if (requestId !== requestIdRef.current) return
        if (!fileRoot) {
          finish(searchForQuery, () => setSearchResults([]))
          return
        }
        window.agent.searchMentions(fileRoot, searchNeedle, agentEntries, additionalDirs, searchScope)
          .then((results) => { finish(searchForQuery, () => setSearchResults(results)) })
          .catch(() => { finish(searchForQuery, () => setSearchResults([])) })
      }, 150)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, fileRoot, additionalDirs, agentEntries, isBrowseMode, scopeDir])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    /** Feature gates for built-in @-capability chips (settings toggles). */
    const [capabilityEnabled, setCapabilityEnabled] = useState({
      collab: false,
      computer: false,
      browser: false,
    })
    /** False until the first getAppSettings settle — needed before we know whether to wait on apps. */
    const [capabilitySettingsReady, setCapabilitySettingsReady] = useState(false)
    useEffect(() => {
      let cancelled = false
      const apply = (settings: {
        experimentalAgentCollaborationEnabled?: boolean
        computerUseEnabled?: boolean
        cdpEnabled?: boolean
      } | null | undefined) => {
        if (cancelled || !settings) return
        setCapabilityEnabled({
          collab: settings.experimentalAgentCollaborationEnabled === true,
          computer:
            isComputerUseSupportedPlatform(window.app.platform)
            && settings.computerUseEnabled === true,
          browser: settings.cdpEnabled === true,
        })
      }
      void window.app?.getAppSettings?.()
        .then((settings) => {
          apply(settings)
          if (!cancelled) setCapabilitySettingsReady(true)
        })
        .catch(() => {
          if (!cancelled) {
            setCapabilityEnabled({ collab: false, computer: false, browser: false })
            setCapabilitySettingsReady(true)
          }
        })
      const unsub = window.app?.onAppSettingsChange?.((settings) => {
        apply(settings as {
          experimentalAgentCollaborationEnabled?: boolean
          computerUseEnabled?: boolean
          cdpEnabled?: boolean
        } | null)
      })
      return () => {
        cancelled = true
        unsub?.()
      }
    }, [])

    const computerUseEnabled = capabilityEnabled.computer

    const [installedDesktopApps, setInstalledDesktopApps] = useState<InstalledDesktopApp[]>([])
    /** Catalog fetch finished (or skipped). While false, never report empty to ChatInput. */
    const [desktopAppsReady, setDesktopAppsReady] = useState(false)
    useEffect(() => {
      let cancelled = false
      // Wait for settings so we don't treat "computer still unknown" as "no apps".
      if (!capabilitySettingsReady) {
        setDesktopAppsReady(false)
        return
      }
      // Skip catalog load when Computer Use is off — popup must not match desktop apps.
      if (!computerUseEnabled) {
        setInstalledDesktopApps([])
        setDesktopAppsReady(true)
        return
      }
      setDesktopAppsReady(false)
      const list = window.app?.listComputerUseInstalledApps
      if (!list) {
        setInstalledDesktopApps([])
        setDesktopAppsReady(true)
        return
      }
      void list()
        .then((apps) => {
          if (cancelled) return
          setInstalledDesktopApps(Array.isArray(apps) ? apps : [])
          setDesktopAppsReady(true)
        })
        .catch(() => {
          if (cancelled) return
          setInstalledDesktopApps([])
          setDesktopAppsReady(true)
        })
      return () => {
        cancelled = true
      }
    }, [capabilitySettingsReady, computerUseEnabled])

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

    const capabilityLabel = useCallback((id: BuiltinCapabilityId): string => {
      if (id === 'collab') return t('chat.mentionPopup.capabilityCollab')
      if (id === 'computer') return t('chat.mentionPopup.capabilityComputer')
      return t('chat.mentionPopup.capabilityBrowser')
    }, [t])

    const matchedCapabilities = useMemo<FlatItem[]>(() => {
      // Hide when browsing into a subdirectory (`@src/`), but keep on empty `@`.
      if (isBrowseMode && query) return []
      const matches: FlatItem[] = []
      for (const cap of BUILTIN_CAPABILITIES) {
        const label = capabilityLabel(cap.id)
        const idMatch = fuzzyMatchIndices(cap.id, query)
        const nameMatch = fuzzyMatchIndices(label, query)
        const enMatch = fuzzyMatchIndices(cap.displayName, query)
        if (idMatch === null && nameMatch === null && enMatch === null) continue
        matches.push({
          kind: 'capability',
          id: cap.id,
          displayName: label,
          matchIndices: nameMatch ?? enMatch ?? idMatch ?? [],
          // Stay visible but not selectable when the matching settings toggle is off.
          disabled: !capabilityEnabled[cap.id],
        })
      }
      return matches
    }, [capabilityLabel, query, isBrowseMode, capabilityEnabled])

    const matchedDesktopApps = useMemo<FlatItem[]>(() => {
      // Only when Computer Use is enabled.
      if (!computerUseEnabled) return []
      // Hide when browsing into a subdirectory; require a query so empty `@`
      // is not flooded with every installed app (capabilities stay visible).
      if (isBrowseMode && query) return []
      if (!query.trim()) return []
      const matches: FlatItem[] = []
      for (const app of installedDesktopApps) {
        const nameMatch = fuzzyMatchIndices(app.app, query)
        const idMatch = fuzzyMatchIndices(app.bundleId, query)
        let aliasMatch: number[] | null = null
        for (const alias of app.aliases ?? []) {
          aliasMatch = fuzzyMatchIndices(alias, query)
          if (aliasMatch !== null) break
        }
        if (nameMatch === null && idMatch === null && aliasMatch === null) continue
        matches.push({
          kind: 'desktop-app',
          bundleId: app.bundleId,
          displayName: app.app,
          matchIndices: nameMatch ?? aliasMatch ?? idMatch ?? [],
        })
        if (matches.length >= DESKTOP_APP_MENTION_LIMIT) break
      }
      return matches
    }, [computerUseEnabled, installedDesktopApps, query, isBrowseMode])

    const flatItems: FlatItem[] = useMemo(() => {
      if (isBrowseMode) {
        const items: FlatItem[] = [
          ...matchedCapabilities,
          ...matchedDesktopApps,
          ...matchedMiniApps,
        ]
        for (const entry of dirEntries) items.push({ kind: 'dir-entry', entry, prefix: browseDir })
        if (!query) {
          for (const a of agentEntries) {
            items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [] })
          }
        }
        return items
      }

      const prefixLen = scopeDir?.length ?? 0
      const items: FlatItem[] = [
        ...matchedCapabilities,
        ...matchedDesktopApps,
        ...matchedMiniApps,
      ]
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
    }, [isBrowseMode, browseDir, query, searchResults, dirEntries, agentEntries, scopeDir, matchedCapabilities, matchedDesktopApps, matchedMiniApps])

    const mentionGroups = useMemo(
      () => groupItems(flatItems, mentionGroupKey, MENTION_GROUP_ORDER),
      [flatItems]
    )
    const orderedItems = useMemo(() => mentionGroups.flatMap((g) => g.items), [mentionGroups])

    useEffect(() => {
      // Only report emptiness for the query we actually finished fetching.
      // Without this, a fast "@docs/temp" can briefly pair the new query with
      // still-true searchCompleted + empty/stale items and permanently suppress
      // the popup via ChatInput's mentionEmptyByAtRef prefix lock.
      if (!searchCompleted || completedQuery !== query) return
      // Async installed-app catalog must finish before we can say "no matches".
      // Otherwise file-search empties first, ChatInput locks the @ prefix, and
      // desktop apps that arrive a moment later never surface.
      if (!desktopAppsReady) return
      onResultState?.(query, orderedItems.length === 0)
    }, [searchCompleted, completedQuery, orderedItems.length, query, onResultState, desktopAppsReady])

    const handleItemClick = useCallback(
      (item: FlatItem, action: 'navigate' | 'select') => {
        if (item.kind === 'capability' && item.disabled) return
        if (action === 'navigate' && isDirItem(item)) {
          onSelect(getNavigatePath(item), 'navigate')
        } else if (item.kind === 'miniapp') {
          onSelect(item.appId, 'select', 'miniapp', item.displayName)
        } else if (item.kind === 'desktop-app') {
          onSelect(item.bundleId, 'select', 'desktop-app', item.displayName)
        } else if (item.kind === 'capability') {
          onSelect(item.id, 'select', item.id, item.displayName)
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
      if (key === 'capability') return t('chat.mentionPopup.groupCapabilities')
      if (key === 'desktop-app') return t('chat.mentionPopup.groupDesktopApps')
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
      if (item.kind === 'capability') {
        const disabled = !!item.disabled
        const disabledHint =
          item.id === 'computer'
            ? t('chat.mentionPopup.computerUseDisabledHint')
            : item.id === 'collab'
              ? t('chat.mentionPopup.collabDisabledHint')
              : t('chat.mentionPopup.browserDisabledHint')
        return (
          <button
            key={`c-${item.id}`}
            ref={setItemRef(i)}
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return
              onSelect(item.id, 'select', item.id, item.displayName)
            }}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={cn(
              rowClass,
              disabled &&
                'cursor-not-allowed opacity-55 hover:bg-transparent data-[disabled]:pointer-events-auto',
            )}
          >
            {capabilityIcon(item.id, disabled)}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">
                <HighlightedPath path={item.displayName} indices={item.matchIndices} />
              </span>
              {disabled ? (
                <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                  {disabledHint}
                </span>
              ) : (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  @{item.id}
                </span>
              )}
            </span>
            {disabled && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                {t('chat.mentionPopup.disabled')}
              </span>
            )}
          </button>
        )
      }
      if (item.kind === 'desktop-app') {
        return (
          <button
            key={`d-${item.bundleId}`}
            ref={setItemRef(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item.bundleId, 'select', 'desktop-app', item.displayName)}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            <DesktopAppIcon bundleId={item.bundleId} className="size-3.5" />
            <span className="min-w-0 flex-1 truncate font-medium">
              <HighlightedPath path={item.displayName} indices={item.matchIndices} />
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <MousePointer2 className="size-2.5 shrink-0" />
              {t('chat.mentionPopup.capabilityComputer')}
            </span>
          </button>
        )
      }
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
            <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-xs text-muted-foreground">
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

    if (searchCompleted && completedQuery === query && orderedItems.length === 0) return null

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-popover flex flex-col">
        <div className="overflow-y-auto p-1 flex-1 min-h-0">
          {(breadcrumbs.length > 0 || (isBrowseMode && projectName)) && (
            <div className="flex items-center gap-0.5 px-2 py-1 text-xs text-muted-foreground">
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

        <div className="border-t border-border px-2 py-1 text-xs text-muted-foreground shrink-0">
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
