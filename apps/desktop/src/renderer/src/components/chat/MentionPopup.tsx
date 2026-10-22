import { Fragment, useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Bot, Folder, Globe, LayoutDashboard, MessageSquare, MousePointer2 } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { useChatStore, useActiveSession, type MentionKind } from '@/stores/chat'
import { useAppStore, useEffectiveProjectRoot } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { mentionCapabilityAvailability } from '@superone/shared/mention-capabilities'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import { useTranslation } from 'react-i18next'
import type {
  AgentMentionTarget,
  ListDirEntry,
  MentionSearchItem,
  PinnedSessionEntry,
} from '@superone/shared/agent-types'
import { formatCompactAge } from '@superone/shared/relative-time'
import { PLAIN_MENTION_GROUP_LIMIT, orderDirectSearchGroups, shouldDirectSearch, type DirectSearchRankedGroup } from '@superone/shared/mention-direct-search'
import { compareMentionMatchKeys, fileMentionMatchKey, gitMentionRefMatchKey, mentionMatchKey, sortByMentionMatch, type MentionMatchKey } from '@superone/shared/mention-match-tier'
import { BUILTIN_CAPABILITIES, type BuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { listAgentMentionTargets } from '@/lib/agent-mention-targets'
import { resolveSessionIconFromBrandKey } from '@/components/harness/resolve-session-icon'
import { groupItems, PopupSectionHeader } from './popup-groups'
import {
  SESSION_MENTION_NAV_PREFIX,
  SESSION_MENTION_KEYWORD,
  SESSION_MENTION_SEARCH_LIMIT,
  parseSessionMentionQuery,
  listSessionProjectCompletions,
  sessionProjectsOnHost,
  hostLocalProjectPaths,
  searchSessionMentions,
  titleMatchIndices,
} from './session-mention-query'
import {
  compareBuiltinMentionMatches,
  matchBuiltinMention,
  type BuiltinMentionMatchRank,
} from './mention-capability-match'
import {
  GIT_MENTION_KEYWORD,
  GIT_MENTION_NAV_PREFIX,
  encodeGitMentionValue,
  gitMentionDisplayName,
  gitRefMatchIndices,
  listGitRefKindChoices,
  GH_MENTION_KEYWORD,
  GH_MENTION_NAV_PREFIX,
} from './git-mention-query'
import { useGitMention } from './use-git-mention'
import {
  GIT_MENTION_GROUP_ORDER,
  GitKindRow,
  GitMentionEmpty,
  GitMentionFooter,
  GitMentionHeader,
  GitPortalRow,
  GitRefRow,
  gitMentionGroupKey,
  gitMentionGroupLabelKey,
  gitPortalLabelKey,
  isGitFlatItem,
  type GitFlatItem,
} from './GitMentionRows'
import { SESSION_META_CLASS, STACKED_BODY_CLASS, STACKED_DETAIL_CLASS, STACKED_ICON_CLASS, STACKED_ROW_CLASS, mentionRowClass } from './mention-row-layout'
import { encodeMcpMentionValue, mcpMentionGroupKey, mcpMentionHasStatus } from '@superone/shared/mcp-app-mentions'
import { useMcpMentionSearch } from '@/components/mcp-apps/mention-search'
import type { McpAppRoute } from '@/components/mcp-apps/desktop-executor'
import { McpMentionRow, McpMentionStatus, mcpMentionFlatItems, type McpMentionFlatItem } from './McpMentionRows'

export { SESSION_MENTION_NAV_PREFIX }

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
  /** Session whose MCP servers are asked for `mentions/search` items; none without a session. */
  mcpRoute?: McpAppRoute | null
}

/** Built-in entry that opens session search (not a capability-prompt-tags id). */
type SessionPortalId = typeof SESSION_MENTION_KEYWORD

type FlatItem =
  | {
      /** A launchable agent / run configuration — `@codex`, `@grok`. */
      kind: 'agent-profile'
      target: AgentMentionTarget
      /** Highlight on the display label. */
      matchIndices: number[]
      /** Highlight on the `@slug` suffix. */
      keywordMatchIndices: number[]
      matchRank: BuiltinMentionMatchRank
    }
  | { kind: 'file'; path: string; displayPath: string; isDirectory: boolean; matchIndices: number[] }
  | { kind: 'dir-entry'; entry: ListDirEntry; prefix: string }
  | { kind: 'agent'; name: string; model: string; matchIndices: number[] }
  | { kind: 'miniapp'; appId: string; displayName: string; matchIndices: number[] }
  | {
      kind: 'capability'
      id: BuiltinCapabilityId
      displayName: string
      /** Highlight on display name (empty when only @id matched). */
      matchIndices: number[]
      /** Highlight on the @keyword suffix. */
      keywordMatchIndices: number[]
      /** Sort key: id matches beat display-name matches. */
      matchRank: BuiltinMentionMatchRank
      disabled?: boolean
    }
  | {
      /** Built-in “Session” portal — Tab/Enter navigates into session search. */
      kind: 'session-portal'
      id: SessionPortalId
      displayName: string
      matchIndices: number[]
      keywordMatchIndices: number[]
      matchRank: BuiltinMentionMatchRank
    }
  | {
      /** Project label completion — Tab navigates to `session <label> `. */
      kind: 'session-project'
      token: string
      label: string
      hint: string
      matchIndices: number[]
    }
  | {
      kind: 'session'
      sessionId: string
      title: string
      /** When the session was last active. Empty when the host omitted it. */
      lastActiveAt: string
      projectLabel: string
      matchIndices: number[]
    }
  | {
      kind: 'desktop-app'
      bundleId: string
      displayName: string
      matchIndices: number[]
    }
  | GitFlatItem
  | McpMentionFlatItem

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

/**
 * Renders an `@handle`. The typed `@` is part of the user's query, so it is
 * highlighted together with the keyword whenever the keyword itself matched.
 */
function HighlightedHandle({ keyword, indices }: { keyword: string; indices: number[] }) {
  const shifted = indices.length > 0 ? [0, ...indices.map((i) => i + 1)] : indices
  return <HighlightedText text={`@${keyword}`} indices={shifted} className="truncate" />
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
  if (item.kind === 'agent-profile') return item.target.ref
  if (item.kind === 'agent') return item.name
  if (item.kind === 'miniapp') return item.appId
  if (item.kind === 'capability') return item.id
  if (item.kind === 'desktop-app') return item.bundleId
  return ''
}

export const MENTION_GROUP_ORDER = ['capability', 'agent-profile', 'session-project', 'session', ...GIT_MENTION_GROUP_ORDER, 'desktop-app', 'agent', 'miniapp', 'file'] as const

function directSearchGroupKeys(
  items: readonly FlatItem[],
  query: string,
): Partial<Record<DirectSearchRankedGroup, MentionMatchKey | null>> {
  const best: Partial<Record<DirectSearchRankedGroup, MentionMatchKey>> = {}
  const consider = (key: DirectSearchRankedGroup, match: MentionMatchKey | null) => {
    if (match == null) return
    const prev = best[key]
    if (prev == null || compareMentionMatchKeys(match, prev) < 0) best[key] = match
  }
  for (const item of items) {
    if (item.kind === 'dir-entry') consider('file', fileMentionMatchKey(item.prefix + item.entry.name, query))
    else if (item.kind === 'file') consider('file', fileMentionMatchKey(item.path, query))
    else if (item.kind === 'session') consider('session', mentionMatchKey(item.title, query))
    else if (item.kind === 'git-ref') {
      const key = `git-${item.ref.kind}`
      if (key === 'git-branch' || key === 'git-worktree' || key === 'git-tag') {
        consider(key, gitMentionRefMatchKey(item.ref, query))
      }
    }
  }
  return best
}

function mentionGroupKey(item: FlatItem): string {
  if (isGitFlatItem(item)) return gitMentionGroupKey(item)
  if (item.kind === 'agent-profile') return 'agent-profile'
  if (item.kind === 'capability' || item.kind === 'session-portal') return 'capability'
  if (item.kind === 'session-project') return 'session-project'
  if (item.kind === 'session') return 'session'
  if (item.kind === 'desktop-app') return 'desktop-app'
  if (item.kind === 'agent') return 'agent'
  if (item.kind === 'miniapp') return 'miniapp'
  if (item.kind === 'mcp-resource') return mcpMentionGroupKey(item)
  return 'file'
}

function capabilityIcon(id: BuiltinCapabilityId | SessionPortalId, disabled?: boolean) {
  const muted = disabled ? 'text-muted-foreground' : undefined
  if (id === SESSION_MENTION_KEYWORD) {
    return (
      <MessageSquare
        className={cn(
          'size-3.5 shrink-0',
          // Sessions stay neutral; the coloured hues below are capability identities.
          muted ?? 'text-foreground',
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
  if (id === 'widget') {
    return (
      <LayoutDashboard
        className={cn(
          'size-3.5 shrink-0',
          muted ?? 'text-amber-600 dark:text-amber-400',
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
  function MentionPopup({ query, selectedIndex, onSelect, onSetSelectedIndex, onResultState, showAgents = true, mcpRoute = null }, ref) {
    const { t, i18n } = useTranslation()
    const agentProfilesEnabled = useAppStore((s) => s.experimentalAgentProfilesEnabled)
    const activeProject = useChatStore((s) => s.activeProject)
    const recentFolders = useAppStore((s) => s.recentFolders)
    const fileRoot = useEffectiveProjectRoot()
    const agents = useActiveSession((s) => s.agents)
    const additionalDirs = useActiveSession((s) => s.additionalDirs)
    const [dirEntries, setDirEntries] = useState<ListDirEntry[]>([])
    const [searchResults, setSearchResults] = useState<MentionSearchItem[]>([])
    // True only after a missing directory or an empty scoped search was replaced
    // by an unscoped search of the whole query. Display paths stay unsliced then.
    const [fileFallback, setFileFallback] = useState(false)
    // Only true when results were produced for `completedQuery` (guards empty-suppression races).
    const [searchCompleted, setSearchCompleted] = useState(false)
    const [completedQuery, setCompletedQuery] = useState<string | null>(null)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
    const listScrollRef = useRef<HTMLDivElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    // Bumps on every query/root change so in-flight listDirectory/searchMentions
    // responses from a previous keystroke cannot clobber newer state.
    const requestIdRef = useRef(0)
    const sessionLoadGenRef = useRef(0)

    const agentEntries = useMemo(
      () => showAgents ? agents.map((a) => ({ name: a.name, model: a.model || '' })) : [],
      [agents, showAgents]
    )

    const projectOptions = useMemo(
      () => sessionProjectsOnHost(recentFolders, activeProject),
      [recentFolders, activeProject],
    )

    const parsedSessionQuery = useMemo(
      () => parseSessionMentionQuery(query, { projects: projectOptions }),
      [query, projectOptions],
    )
    const isSessionMode = parsedSessionQuery !== null
    const git = useGitMention(query, fileRoot)
    const isGitMode = git.isGitMode
    // A portal grammar (`@session …`, `@git …`) owns the popup: no files, no capabilities.
    const isPortalMode = isSessionMode || isGitMode
    const directSearch = !isPortalMode && shouldDirectSearch(query, git.portals)

    const [sessionRows, setSessionRows] = useState<PinnedSessionEntry[]>([])
    const [sessionLoading, setSessionLoading] = useState(false)
    const [sessionSettledFor, setSessionSettledFor] = useState<string | null>(null)
    const directPending = directSearch && (sessionSettledFor !== query || !git.settled)

    const isBrowseMode = !isPortalMode && (!query || query.endsWith('/'))
    // Server items sit beside capabilities: on `@` and plain queries, not inside a portal or a folder.
    const mcp = useMcpMentionSearch(mcpRoute, query, !isPortalMode && !(isBrowseMode && query))
    const mcpItems = useMemo(() => mcpMentionFlatItems(mcp.sources, query), [mcp.sources, query])
    const mcpShowsStatus = mcpMentionHasStatus(mcp)
    const browseDir = isBrowseMode ? query : ''
    const lastSlash = query.lastIndexOf('/')
    const scopeDir = !isPortalMode && !isBrowseMode && lastSlash >= 0 ? query.slice(0, lastSlash + 1) : undefined

    // `@session` (recent or a title, optional project scope) and plain `@foo`
    // share one search. A title waits for typing to settle; recent does not.
    useEffect(() => {
      const portal = parsedSessionQuery
      const plain = !portal && directSearch
      const gen = ++sessionLoadGenRef.current
      if (!portal && !plain) {
        setSessionRows([])
        setSessionLoading(false)
        setSessionSettledFor(query)
        return
      }
      const titleQuery = portal ? portal.titleQuery : query.trim()
      const limit = portal ? SESSION_MENTION_SEARCH_LIMIT : PLAIN_MENTION_GROUP_LIMIT
      const paths = portal?.projects ? hostLocalProjectPaths(portal.projects) : undefined
      // Keep the previous rows until this request answers. Clearing them
      // emptied the session group on every keystroke.
      setSessionLoading(true)
      setSessionSettledFor(null)
      const timer = setTimeout(() => {
        void searchSessionMentions(activeProject || '', titleQuery, limit, paths)
          .then((rows) => {
            if (gen !== sessionLoadGenRef.current) return
            setSessionRows(rows)
            setSessionLoading(false)
            setSessionSettledFor(query)
          })
          .catch(() => {
            if (gen !== sessionLoadGenRef.current) return
            setSessionRows([])
            setSessionLoading(false)
            setSessionSettledFor(query)
          })
      }, titleQuery ? MENTION_SEARCH_DEBOUNCE_MS : 0)
      return () => clearTimeout(timer)
    }, [parsedSessionQuery, directSearch, query, activeProject])

    useEffect(() => {
      const requestId = ++requestIdRef.current
      setSearchCompleted(false)
      setCompletedQuery(null)
      setFileFallback(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)

      const finish = (forQuery: string, apply: () => void) => {
        if (requestId !== requestIdRef.current) return
        apply()
        setCompletedQuery(forQuery)
        setSearchCompleted(true)
      }
      const stale = () => requestId !== requestIdRef.current

      // Portal modes (session / git) load via their own effects. Mark the file
      // search finished so the empty gate does not wait on a request we skipped.
      if (isPortalMode) {
        setDirEntries([])
        setSearchResults([])
        finish(query, () => {})
        return
      }

      // A new keystroke must not keep the previous directory or scoped hits.
      // Session and git rows stay put until their own requests answer.
      setDirEntries([])
      setSearchResults([])

      const searchUnscoped = (needle: string) => {
        if (!fileRoot) return Promise.resolve([] as MentionSearchItem[])
        return window.environment.searchMentions(fileRoot, needle, agentEntries, additionalDirs)
      }
      const finishFallback = (forQuery: string, results: MentionSearchItem[]) => {
        finish(forQuery, () => {
          setDirEntries([])
          setSearchResults(results)
          setFileFallback(true)
        })
      }

      if (isBrowseMode) {
        if (!fileRoot) {
          finish(query, () => {})
          return
        }
        // Bare `@` lists the root. An empty listing there is the catalog, not
        // a missing folder, so it does not widen into a project-wide search.
        if (!query) {
          window.environment.listDirectory(fileRoot, query)
            .then((entries) => { if (!stale()) finish(query, () => setDirEntries(entries)) })
            .catch(() => { if (!stale()) finish(query, () => setDirEntries([])) })
          return
        }
        const browseQuery = query
        const fallback = () => {
          searchUnscoped(browseQuery)
            .then((results) => { if (!stale()) finishFallback(browseQuery, results) })
            .catch(() => { if (!stale()) finishFallback(browseQuery, []) })
        }
        window.environment.listDirectory(fileRoot, browseQuery)
          .then((entries) => {
            if (stale()) return
            if (entries.length > 0) {
              finish(browseQuery, () => {
                setDirEntries(entries)
                setSearchResults([])
              })
              return
            }
            fallback()
          })
          .catch(() => { if (!stale()) fallback() })
        return
      }

      const searchForQuery = query
      const searchScope = scopeDir
      const searchNeedle = scopeDir ? query.slice(scopeDir.length) : query
      debounceRef.current = setTimeout(() => {
        if (stale()) return
        if (!fileRoot) {
          finish(searchForQuery, () => setSearchResults([]))
          return
        }
        const fallback = () => {
          searchUnscoped(searchForQuery)
            .then((results) => { if (!stale()) finishFallback(searchForQuery, results) })
            .catch(() => { if (!stale()) finishFallback(searchForQuery, []) })
        }
        window.environment.searchMentions(fileRoot, searchNeedle, agentEntries, additionalDirs, searchScope)
          .then((results) => {
            if (stale()) return
            if (results.length === 0 && searchScope && searchForQuery.trim()) {
              fallback()
              return
            }
            finish(searchForQuery, () => {
              setSearchResults(results)
              setDirEntries([])
            })
          })
          .catch(() => {
            if (stale()) return
            if (searchScope && searchForQuery.trim()) {
              fallback()
              return
            }
            finish(searchForQuery, () => setSearchResults([]))
          })
      }, MENTION_SEARCH_DEBOUNCE_MS)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, fileRoot, additionalDirs, agentEntries, isBrowseMode, scopeDir, isPortalMode])

    useEffect(() => {
      if (selectedIndex >= 0) {
        itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    // Reset selection when entering a portal mode or changing phase (scope → query → search).
    useEffect(() => {
      if (isPortalMode) onSetSelectedIndex(0)
    }, [isPortalMode, parsedSessionQuery?.phase, git.parsed?.phase, onSetSelectedIndex])

    /** Feature gates for built-in @-capability chips (settings toggles). Widget is always on. */
    const [capabilityEnabled, setCapabilityEnabled] = useState<Record<BuiltinCapabilityId, boolean>>({
      computer: false,
      browser: false,
      widget: true,
    })
    /** False until the first getAppSettings settle — needed before we know whether to wait on apps. */
    const [capabilitySettingsReady, setCapabilitySettingsReady] = useState(false)
    useEffect(() => {
      let cancelled = false
      const apply = (settings: {
        computerUseEnabled?: boolean
        cdpEnabled?: boolean
      } | null | undefined) => {
        if (cancelled || !settings) return
        setCapabilityEnabled(mentionCapabilityAvailability(settings, window.app.platform))
      }
      void window.app?.getAppSettings?.()
        .then((settings) => {
          apply(settings)
          if (!cancelled) setCapabilitySettingsReady(true)
        })
        .catch(() => {
          if (!cancelled) {
            setCapabilityEnabled({ computer: false, browser: false, widget: true })
            setCapabilitySettingsReady(true)
          }
        })
      const unsub = window.app?.onAppSettingsChange?.((settings) => {
        apply(settings as {
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

    // Usable agents for THIS project: local desktop rows, or the node's own
    // profiles for a remote project (their agentIds differ).
    const [agentTargets, setAgentTargets] = useState<AgentMentionTarget[]>([])
    useEffect(() => {
      let cancelled = false
      void listAgentMentionTargets(activeProject).then((targets) => {
        if (!cancelled) setAgentTargets(targets)
      })
      return () => {
        cancelled = true
      }
    }, [activeProject, agentProfilesEnabled])

    const matchedAgentTargets = useMemo<FlatItem[]>(() => {
      if (isPortalMode) return []
      if (isBrowseMode && query) return []
      const matches: Array<Extract<FlatItem, { kind: 'agent-profile' }>> = []
      for (const target of agentTargets) {
        // Slug first so `@co` prefers Codex; aliases match but never highlight,
        // because the row shows the slug and highlighting an unshown string lies.
        let scored = matchBuiltinMention(target.slug, [target.displayName], query)
        if (!scored) {
          for (const alias of target.aliases) {
            const aliasMatch = matchBuiltinMention(alias, [target.displayName], query)
            if (aliasMatch) {
              scored = { ...aliasMatch, keywordIndices: [] }
              break
            }
          }
        }
        if (!scored) continue
        matches.push({
          kind: 'agent-profile',
          target,
          matchIndices: scored.labelIndices,
          keywordMatchIndices: scored.keywordIndices,
          matchRank: scored.rank,
        })
      }
      if (query.trim()) {
        matches.sort((a, b) =>
          compareBuiltinMentionMatches(
            { rank: a.matchRank, keyword: a.target.slug },
            { rank: b.matchRank, keyword: b.target.slug },
          ),
        )
      }
      return matches
    }, [agentTargets, query, isBrowseMode, isPortalMode])

    const capabilityLabel = useCallback((id: BuiltinCapabilityId): string => {
      if (id === 'computer') return t('chat.mentionPopup.capabilityComputer')
      if (id === 'widget') return t('chat.mentionPopup.capabilityWidget')
      return t('chat.mentionPopup.capabilityBrowser')
    }, [t])

    const sessionPortalLabel = useCallback(
      () => t('chat.mentionPopup.capabilitySession'),
      [t],
    )

    const matchedCapabilities = useMemo<FlatItem[]>(() => {
      // Hide when browsing into a subdirectory (`@src/`), but keep on empty `@`.
      if (isPortalMode) return []
      if (isBrowseMode && query) return []
      const matches: Array<Extract<FlatItem, { kind: 'capability' | 'session-portal' | 'git-portal' }>> = []
      for (const cap of BUILTIN_CAPABILITIES) {
        const label = capabilityLabel(cap.id)
        // Keyword (@id) outranks display name so `@se` hits session before "Computer Use".
        const scored = matchBuiltinMention(cap.id, [label, cap.displayName], query)
        if (!scored) continue
        matches.push({
          kind: 'capability',
          id: cap.id,
          displayName: label,
          matchIndices: scored.labelIndices,
          keywordMatchIndices: scored.keywordIndices,
          matchRank: scored.rank,
          // Stay visible but not selectable when the matching settings toggle is off.
          disabled: !capabilityEnabled[cap.id],
        })
      }
      // Built-in Session portal — always on; Tab/Enter opens session search page.
      {
        const label = sessionPortalLabel()
        const scored = matchBuiltinMention(
          SESSION_MENTION_KEYWORD,
          [label, 'Session'],
          query,
        )
        if (scored) {
          matches.push({
            kind: 'session-portal',
            id: SESSION_MENTION_KEYWORD,
            displayName: label,
            matchIndices: scored.labelIndices,
            keywordMatchIndices: scored.keywordIndices,
            matchRank: scored.rank,
          })
        }
      }
      // Built-in Git / GitHub portals — disabled (still listed) outside a
      // repository, on an old node, or without a usable `gh`.
      const portals: Array<{ id: typeof GIT_MENTION_KEYWORD | typeof GH_MENTION_KEYWORD; aliases: string[]; disabledReason?: 'not-repo' | 'unsupported' | 'gh-unavailable' }> = [
        {
          id: GIT_MENTION_KEYWORD,
          aliases: ['Git'],
          ...(git.availability === 'not-repo' || git.availability === 'unsupported'
            ? { disabledReason: git.availability }
            : {}),
        },
        {
          id: GH_MENTION_KEYWORD,
          aliases: ['GitHub', 'issue', 'pr'],
          ...(git.availability === 'not-repo' || git.availability === 'unsupported'
            ? { disabledReason: git.availability }
            : git.availability === 'ready' && !git.githubAvailable ? { disabledReason: 'gh-unavailable' as const } : {}),
        },
      ]
      for (const portal of portals) {
        const label = t(gitPortalLabelKey(portal.id))
        const scored = matchBuiltinMention(portal.id, [label, ...portal.aliases], query)
        if (!scored) continue
        matches.push({
          kind: 'git-portal',
          id: portal.id,
          displayName: label,
          matchIndices: scored.labelIndices,
          keywordMatchIndices: scored.keywordIndices,
          matchRank: scored.rank,
          ...(portal.disabledReason ? { disabledReason: portal.disabledReason } : {}),
        })
      }
      // Only re-rank when the user is filtering — empty `@` keeps catalog order.
      if (query.trim()) {
        matches.sort((a, b) =>
          compareBuiltinMentionMatches(
            { rank: a.matchRank, keyword: a.id },
            { rank: b.matchRank, keyword: b.id },
          ),
        )
      }
      return matches
    }, [capabilityLabel, sessionPortalLabel, query, isBrowseMode, isPortalMode, capabilityEnabled, git.availability, git.githubAvailable, t])

    const sessionFlatItems = useCallback((rows: PinnedSessionEntry[], titleQ: string, showProject: boolean): FlatItem[] => {
      return rows.map((row) => {
        const title = (row.title || 'Untitled').trim() || 'Untitled'
        return {
          kind: 'session' as const,
          sessionId: row.sessionId,
          title,
          lastActiveAt: row.lastActiveAt,
          projectLabel: showProject ? row.folderName : '',
          matchIndices: titleQ ? titleMatchIndices(title, titleQ) : [],
        }
      })
    }, [])

    const matchedSessionProjects = useMemo<FlatItem[]>(() => {
      if (!parsedSessionQuery?.projectToken) return []
      return listSessionProjectCompletions(
        projectOptions,
        parsedSessionQuery.projectToken,
        activeProject,
      ).map((choice) => ({
        kind: 'session-project' as const,
        token: choice.token,
        label: choice.label,
        hint: choice.hint,
        matchIndices: choice.matchIndices,
      }))
    }, [parsedSessionQuery, projectOptions, activeProject])

    const matchedSessions = useMemo<FlatItem[]>(() => {
      if (!parsedSessionQuery) return []
      return sessionFlatItems(sessionRows, parsedSessionQuery.titleQuery, parsedSessionQuery.projects == null)
    }, [parsedSessionQuery, sessionRows, sessionFlatItems])

    const plainSessions = useMemo<FlatItem[]>(() => {
      if (!directSearch) return []
      const titleQ = query.trim()
      const ranked = sortByMentionMatch(sessionRows, titleQ, (row) => (row.title || 'Untitled').trim() || 'Untitled')
      return sessionFlatItems(ranked, titleQ, true)
    }, [directSearch, sessionRows, query, sessionFlatItems])

    // Why the portal the user typed into cannot be used here, if known. Typing
    // `@gh` enters the grammar before the row could be greyed out, so the
    // picker itself has to say why instead of offering kinds.
    const gitPortalUnavailable = useMemo<'not-repo' | 'unsupported' | 'gh-unavailable' | null>(() => {
      const parsed = git.parsed
      if (!parsed) return null
      if (git.availability === 'not-repo' || git.availability === 'unsupported') return git.availability
      if (parsed.portal === 'gh' && git.availability === 'ready' && !git.githubAvailable) return 'gh-unavailable'
      return null
    }, [git.parsed, git.availability, git.githubAvailable])

    const gitRefItems = useCallback((refs: typeof git.refs, refQuery: string): FlatItem[] => {
      return refs.map((ref) => {
        const indices = gitRefMatchIndices(ref, refQuery)
        return { kind: 'git-ref' as const, ref, matchIndices: indices.label, detailMatchIndices: indices.detail }
      })
    }, [])

    const matchedGitItems = useMemo<FlatItem[]>(() => {
      const parsed = git.parsed
      if (!parsed) return []
      if (gitPortalUnavailable) return []
      const kindRows: FlatItem[] = parsed.phase === 'pick-kind'
        || (parsed.phase === 'search' && parsed.refKind == null && parsed.kindToken)
        ? listGitRefKindChoices(parsed.portal, parsed.kindToken).map((choice) => ({
          kind: 'git-kind' as const,
          portal: parsed.portal,
          refKind: choice.kind,
          matchIndices: choice.matchIndices,
        }))
        : []
      if (parsed.phase === 'pick-kind') return kindRows
      return [...kindRows, ...gitRefItems(git.refs, parsed.refQuery)]
    }, [git.parsed, git.refs, gitPortalUnavailable, gitRefItems])

    const plainGitItems = useMemo<FlatItem[]>(() => {
      if (!directSearch) return []
      return gitRefItems(git.refs, query.trim())
    }, [directSearch, git.refs, query, gitRefItems])

    const matchedDesktopApps = useMemo<FlatItem[]>(() => {
      // Only when Computer Use is enabled.
      if (!computerUseEnabled) return []
      if (isPortalMode) return []
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
    }, [computerUseEnabled, installedDesktopApps, query, isBrowseMode, isPortalMode])

    const flatItems: FlatItem[] = useMemo(() => {
      if (isGitMode) return matchedGitItems
      if (isSessionMode) return [...matchedSessionProjects, ...matchedSessions]
      // A real directory listing (or bare `@`) stays a listing. Sessions and
      // git refs for a plain query sit with it. A missing folder has no
      // entries, and its fallback files render on the search path below.
      if (isBrowseMode && (dirEntries.length > 0 || !query)) {
        const items: FlatItem[] = [
          ...matchedAgentTargets,
          ...matchedCapabilities,
          ...(directSearch ? plainSessions : []),
          ...(directSearch ? plainGitItems : []),
          ...matchedDesktopApps,
          ...matchedMiniApps,
          ...mcpItems,
        ]
        for (const entry of dirEntries) items.push({ kind: 'dir-entry', entry, prefix: browseDir })
        if (!query) {
          for (const a of agentEntries) {
            items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [] })
          }
        }
        return items
      }

      // Fell back from a missing directory or an empty scoped search: the
      // hits are project-wide, so the typed directory is not a display prefix.
      const displayScope = fileFallback ? undefined : scopeDir
      const prefixLen = displayScope?.length ?? 0
      const items: FlatItem[] = [
        ...matchedAgentTargets,
        ...matchedCapabilities,
        ...plainSessions,
        ...plainGitItems,
        ...matchedDesktopApps,
        ...matchedMiniApps,
        ...mcpItems,
      ]
      for (const item of searchResults) {
        if (item.kind === 'agent') {
          items.push({ kind: 'agent', name: item.name, model: item.model, matchIndices: item.matchIndices })
        } else {
          const displayPath = displayScope ? item.path.slice(prefixLen) : item.path
          const displayIndices = displayScope ? item.matchIndices.map((i) => i - prefixLen).filter((i) => i >= 0) : item.matchIndices
          items.push({ kind: 'file', path: item.path, displayPath, isDirectory: item.isDirectory, matchIndices: displayIndices })
        }
      }
      return items
    }, [isGitMode, matchedGitItems, isSessionMode, matchedSessionProjects, matchedSessions, plainSessions, plainGitItems, isBrowseMode, browseDir, query, searchResults, dirEntries, agentEntries, scopeDir, fileFallback, directSearch, matchedCapabilities, matchedDesktopApps, matchedMiniApps, matchedAgentTargets, mcpItems])

    // Server sections are dynamic; they go right before files, which can run long.
    const mcpGroupKeys = useMemo(() => mcp.sources.map(mcpMentionGroupKey), [mcp.sources])
    const mentionGroups = useMemo(() => {
      const base = MENTION_GROUP_ORDER.flatMap((key) => key === 'file' ? [...mcpGroupKeys, key] : [key])
      const order = shouldDirectSearch(query) ? orderDirectSearchGroups(base, directSearchGroupKeys(flatItems, query)) : base
      return groupItems(flatItems, mentionGroupKey, order)
    }, [flatItems, mcpGroupKeys, query])
    const orderedItems = useMemo(() => mentionGroups.flatMap((g) => g.items), [mentionGroups])

    // Clamp selected index when a portal list grows/shrinks
    useEffect(() => {
      if (!isPortalMode) return
      if (orderedItems.length === 0) return
      if (selectedIndex >= orderedItems.length) onSetSelectedIndex(orderedItems.length - 1)
    }, [isPortalMode, orderedItems.length, selectedIndex, onSetSelectedIndex])

    useEffect(() => {
      // Only report emptiness for the query we actually finished fetching.
      // Without this, a fast "@docs/temp" can briefly pair the new query with
      // still-true searchCompleted + empty/stale items and permanently suppress
      // the popup via ChatInput's mentionEmptyByAtRef prefix lock.
      if (!searchCompleted || completedQuery !== query) return
      // Portal modes stay open even when empty / still loading more.
      if (isPortalMode) {
        onResultState?.(query, false)
        return
      }
      // Plain `@foo` still has session and git rows in flight. Reporting empty
      // now would lock the popup shut before they arrive.
      if (directPending) return
      // Async installed-app catalog must finish before we can say "no matches".
      // Otherwise file-search empties first, ChatInput locks the @ prefix, and
      // desktop apps that arrive a moment later never surface.
      if (!desktopAppsReady) return
      // Same for server items, which can take seconds while a harness starts.
      if (mcp.loading) return
      onResultState?.(query, orderedItems.length === 0 && !mcpShowsStatus)
    }, [searchCompleted, completedQuery, orderedItems.length, query, onResultState, desktopAppsReady, isPortalMode, directPending, mcp.loading, mcpShowsStatus])

    const handleItemClick = useCallback(
      (item: FlatItem, action: 'navigate' | 'select') => {
        if (item.kind === 'capability' && item.disabled) return
        // Built-in Session → switch popup to session search page (both Tab and Enter).
        if (item.kind === 'session-portal') {
          onSelect(SESSION_MENTION_NAV_PREFIX, 'navigate')
          return
        }
        // Project / all — Tab or Enter completes scope into the query (trailing space).
        if (item.kind === 'session-project') {
          onSelect(`${SESSION_MENTION_KEYWORD} ${item.token} `, 'navigate')
          return
        }
        if (item.kind === 'session') {
          onSelect(item.sessionId, 'select', 'session', item.title)
          return
        }
        if (item.kind === 'git-portal') {
          if (item.disabledReason === undefined) {
            onSelect(item.id === GH_MENTION_KEYWORD ? GH_MENTION_NAV_PREFIX : GIT_MENTION_NAV_PREFIX, 'navigate')
          }
          return
        }
        if (item.kind === 'git-kind') {
          onSelect(`${item.portal} ${item.refKind} `, 'navigate')
          return
        }
        if (item.kind === 'git-ref') {
          onSelect(encodeGitMentionValue(item.ref.kind, item.ref.id, item.ref.host), 'select', 'git', gitMentionDisplayName(item.ref))
          return
        }
        if (item.kind === 'agent-profile') {
          onSelect(item.target.ref, 'select', 'agent-profile', item.target.displayName)
          return
        }
        if (item.kind === 'mcp-resource') {
          onSelect(encodeMcpMentionValue(item.server, item.item.uri), 'select', 'mcp-resource', item.item.label)
          return
        }
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
          // Portal / scope rows: Tab navigates (autocomplete).
          if (item.kind === 'session-portal' || item.kind === 'session-project' || item.kind === 'git-portal' || item.kind === 'git-kind') {
            handleItemClick(item, 'navigate')
            return
          }
          handleItemClick(item, isDirItem(item) ? 'navigate' : 'select')
        },
        confirmEnter: () => {
          const item = getSelectedItem()
          if (!item) return
          // Portal / scope rows: Enter also completes scope (not insert).
          if (item.kind === 'session-portal' || item.kind === 'session-project' || item.kind === 'git-portal' || item.kind === 'git-kind') {
            handleItemClick(item, 'navigate')
            return
          }
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
      const gitKey = gitMentionGroupLabelKey(key)
      if (gitKey) return t(gitKey)
      if (key === 'agent-profile') return t('chat.mentionPopup.groupCollaborators')
      if (key === 'capability') return t('chat.mentionPopup.groupCapabilities')
      if (key === 'session-project') return t('chat.mentionPopup.groupSessionProjects')
      if (key === 'session') {
        return parsedSessionQuery?.phase === 'recent'
          ? t('chat.mentionPopup.groupRecentSessions')
          : t('chat.mentionPopup.groupSessions')
      }
      if (key === 'desktop-app') return t('chat.mentionPopup.groupDesktopApps')
      if (key === 'agent') return t('chat.mentionPopup.groupAgents')
      if (key === 'miniapp') return t('chat.mentionPopup.groupMiniApps')
      const source = mcp.sources.find((value) => mcpMentionGroupKey(value) === key)
      if (source) return source.title
      return t('chat.mentionPopup.groupFiles')
    }

    const setItemRef = (i: number) => (el: HTMLButtonElement | null) => {
      if (el) itemRefs.current.set(i, el)
      else itemRefs.current.delete(i)
    }

    const renderItem = (item: FlatItem, i: number) => {
      const rowClass = mentionRowClass(i === selectedIndex)
      if (item.kind === 'git-portal') {
        return (
          <GitPortalRow
            key={`c-${item.id}-portal`}
            item={item}
            index={i}
            selected={i === selectedIndex}
            setItemRef={setItemRef(i)}
            onHover={() => onSetSelectedIndex(i)}
            onNavigate={() => handleItemClick(item, 'navigate')}
          />
        )
      }
      if (item.kind === 'git-kind') {
        return (
          <GitKindRow
            key={`gk-${item.refKind}`}
            item={item}
            index={i}
            selected={i === selectedIndex}
            setItemRef={setItemRef(i)}
            onHover={() => onSetSelectedIndex(i)}
            onNavigate={() => handleItemClick(item, 'navigate')}
          />
        )
      }
      if (item.kind === 'git-ref') {
        return (
          <GitRefRow
            key={`gr-${item.ref.kind}-${item.ref.id}`}
            item={item}
            index={i}
            selected={i === selectedIndex}
            setItemRef={setItemRef(i)}
            onHover={() => onSetSelectedIndex(i)}
            onSelect={() => handleItemClick(item, 'select')}
          />
        )
      }
      if (item.kind === 'mcp-resource') {
        return (
          <McpMentionRow
            key={`mcp-${item.server}-${item.tool}-${item.item.uri}`}
            entry={item}
            selected={i === selectedIndex}
            setItemRef={setItemRef(i)}
            onHover={() => onSetSelectedIndex(i)}
            onSelect={() => handleItemClick(item, 'select')}
          />
        )
      }
      if (item.kind === 'session-portal') {
        return (
          <button
            key="c-session-portal"
            ref={setItemRef(i)}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleItemClick(item, 'navigate')}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            {capabilityIcon(SESSION_MENTION_KEYWORD)}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">
                <HighlightedPath path={item.displayName} indices={item.matchIndices} />
              </span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                <HighlightedHandle
                  keyword={SESSION_MENTION_KEYWORD}
                  indices={item.keywordMatchIndices}
                />
              </span>
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              <Kbd>tab</Kbd>
            </span>
          </button>
        )
      }
      if (item.kind === 'session-project') {
        return (
          <button
            key={`sp-${item.token}`}
            ref={setItemRef(i)}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleItemClick(item, 'navigate')}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            <Folder className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">
                <HighlightedPath path={item.label} indices={item.matchIndices} />
              </span>
              <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                {item.hint}
              </span>
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              <Kbd>tab</Kbd>
            </span>
          </button>
        )
      }
      if (item.kind === 'session') {
        const age = formatCompactAge(item.lastActiveAt, { locale: i18n.language })
        return (
          <button
            key={`sess-${item.sessionId}`}
            ref={setItemRef(i)}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleItemClick(item, 'select')}
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={cn(rowClass, STACKED_ROW_CLASS)}
          >
            <MessageSquare className={cn('size-3.5 shrink-0 text-foreground', STACKED_ICON_CLASS)} />
            <span className={STACKED_BODY_CLASS}>
              <span className="min-w-0 truncate font-medium @md:flex-1">
                <HighlightedPath path={item.title} indices={item.matchIndices} />
              </span>
              {item.projectLabel || age ? (
                <span className={cn(SESSION_META_CLASS, !item.projectLabel && '@md:shrink-0')}>
                  {item.projectLabel ? (
                    <span className={cn(STACKED_DETAIL_CLASS, !age && '@md:max-w-20 @md:shrink-0')}>{item.projectLabel}</span>
                  ) : null}
                  {age ? <span className={cn(STACKED_DETAIL_CLASS, 'shrink-0')}>{age}</span> : null}
                </span>
              ) : null}
            </span>
          </button>
        )
      }
      if (item.kind === 'agent-profile') {
        const Icon = resolveSessionIconFromBrandKey(item.target.brandKey)
        return (
          <button
            key={`ag-${item.target.ref}`}
            ref={setItemRef(i)}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              onSelect(item.target.ref, 'select', 'agent-profile', item.target.displayName)
            }
            onMouseEnter={() => onSetSelectedIndex(i)}
            className={rowClass}
          >
            {Icon ? (
              <span className="flex shrink-0">
                <Icon status="default" renderLevel="compact" />
              </span>
            ) : (
              <Bot className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">
                <HighlightedPath path={item.target.displayName} indices={item.matchIndices} />
              </span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                <HighlightedHandle keyword={item.target.slug} indices={item.keywordMatchIndices} />
              </span>
            </span>
          </button>
        )
      }
      if (item.kind === 'capability') {
        const disabled = !!item.disabled
        const disabledHint =
          item.id === 'computer'
            ? t('chat.mentionPopup.computerUseDisabledHint')
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
                <span className="mt-0.5 block truncate text-2xs font-normal text-muted-foreground">
                  {disabledHint}
                </span>
              ) : (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  <HighlightedHandle keyword={item.id} indices={item.keywordMatchIndices} />
                </span>
              )}
            </span>
            {disabled && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-2xs text-muted-foreground">
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
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-px text-2xs font-medium text-emerald-600 dark:text-emerald-400">
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
            <span className="min-w-0 truncate font-medium">
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
            <span className="min-w-0 truncate">
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

    // Session mode always stays open (empty state). Other modes hide when truly empty.
    if (!isPortalMode && !directPending && searchCompleted && completedQuery === query && orderedItems.length === 0 && !mcpShowsStatus) {
      return null
    }
    // Status-only server sections take their place in the order, before files.
    const mcpStatus = isPortalMode ? null : <McpMentionStatus state={mcp} />
    const fileGroupIndex = mentionGroups.findIndex((group) => group.key === 'file')

    const sessionScopeLabel = parsedSessionQuery?.projects?.[0]?.label ?? ''
    const sessionTitleQ = parsedSessionQuery?.titleQuery ?? ''
    const sessionPhase = parsedSessionQuery?.phase

    return (
      <div
        className={cn(
          'absolute bottom-full left-0 right-0 z-10 mb-1 max-h-72 overflow-hidden rounded-xl border border-border bg-popover flex flex-col',
          // Keep a stable shell while session query updates (avoid flash remount).
          isPortalMode && 'animate-in fade-in-0 duration-150',
        )}
      >
        <div
          ref={listScrollRef}
          // The container the stacked rows (`mention-row-layout`) measure.
          className="@container overflow-y-auto p-1 flex-1 min-h-0"
        >
          {git.parsed ? (
            <GitMentionHeader parsed={git.parsed} onNavigate={(prefix) => onSelect(prefix, 'navigate')} />
          ) : isSessionMode ? (
            <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-2 py-1.5 text-xs">
              <MessageSquare className="size-3.5 shrink-0 text-foreground" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(SESSION_MENTION_NAV_PREFIX, 'navigate')}
                  className="shrink-0 font-medium text-foreground hover:underline"
                >
                  {t('chat.mentionPopup.capabilitySession')}
                </button>
                {sessionScopeLabel ? (
                  <>
                    <span className="shrink-0 text-muted-foreground/50">/</span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelect(SESSION_MENTION_NAV_PREFIX, 'navigate')}
                      className="min-w-0 max-w-40 truncate font-medium text-foreground/90 hover:underline"
                      title={sessionScopeLabel}
                    >
                      {sessionScopeLabel}
                    </button>
                  </>
                ) : null}
                {sessionTitleQ ? (
                  <>
                    <span className="shrink-0 text-muted-foreground/50">/</span>
                    <span className="min-w-0 max-w-48 truncate text-muted-foreground" title={sessionTitleQ}>
                      “{sessionTitleQ}”
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ) : (breadcrumbs.length > 0 || (isBrowseMode && projectName)) ? (
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
          ) : null}

          {git.parsed && orderedItems.length === 0 ? (
            <GitMentionEmpty
              parsed={git.parsed}
              itemCount={orderedItems.length}
              loading={git.loading && !gitPortalUnavailable}
              unavailable={gitPortalUnavailable ?? git.unavailable}
            />
          ) : isSessionMode && orderedItems.length === 0 && !sessionLoading ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground/80">
                {sessionPhase === 'recent'
                  ? t('chat.mentionPopup.noRecentSessions')
                  : t('chat.mentionPopup.noSessions')}
              </div>
            </div>
          ) : (
            <>
              {mentionGroups.map((group, index) => (
                <Fragment key={group.key}>
                  {index === fileGroupIndex ? mcpStatus : null}
                  <div>
                    <PopupSectionHeader label={groupLabel(group.key)} count={group.items.length} />
                    {group.items.map((item, j) => renderItem(item, group.startIndex + j))}
                  </div>
                </Fragment>
              ))}
              {fileGroupIndex < 0 ? mcpStatus : null}
            </>
          )}
          {isSessionMode && sessionLoading ? (
            <div className="px-2 py-1.5 text-2xs text-muted-foreground">
              {t('chat.mentionPopup.loadingSessions')}
            </div>
          ) : null}
          {isGitMode && git.loading && orderedItems.length === 0 ? (
            <div className="px-2 py-1.5 text-2xs text-muted-foreground">
              {t('chat.mentionPopup.loadingGitRefs')}
            </div>
          ) : null}
        </div>

        <div className="border-t border-border px-2 py-1 text-xs text-muted-foreground shrink-0">
          {git.parsed ? (
            <GitMentionFooter parsed={git.parsed} />
          ) : isSessionMode && parsedSessionQuery?.projectToken ? (
            <>
              <Kbd>tab</Kbd> {t('chat.mentionPopup.hintCompleteProject')}
              <span className="mx-1.5">&middot;</span>
              <Kbd>↵</Kbd> {t('chat.mentionPopup.hintSelectSession')}
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          ) : isSessionMode && sessionPhase === 'recent' ? (
            <>
              <Kbd>↵</Kbd> {t('chat.mentionPopup.hintSelectSession')}
              <span className="mx-1.5">&middot;</span>
              {t('chat.mentionPopup.hintTypeTitle')}
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          ) : isSessionMode ? (
            <>
              <Kbd>↵</Kbd> {t('chat.mentionPopup.hintSelectSession')}
              <span className="mx-1.5">&middot;</span>
              <Kbd>↑↓</Kbd> navigate
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          ) : (
            <>
              <Kbd>tab</Kbd> autocomplete
              <span className="mx-1.5">&middot;</span>
              <Kbd>↵</Kbd> select
              <span className="mx-1.5">&middot;</span>
              <Kbd>↑↓</Kbd> navigate
              <span className="mx-1.5">&middot;</span>
              <Kbd>esc</Kbd> close
            </>
          )}
        </div>
      </div>
    )
  }
)
