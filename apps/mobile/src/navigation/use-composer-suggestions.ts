import type { RelayClient } from '@superone/relay-client'
import type { HarnessId } from '@superone/shared/agent-types'
import { requestMentionIcons, requestMentionSearch, type MentionSearchResult } from '../mention-search'
import { MentionIconCache, type MentionIconStore } from '../mention-icon-cache'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ChatRuntime } from '../runtime'
import { cursorAfterEdit, type ComposerCursor } from '../composer-cursor'
import { extractMentionQuery, insertMention, parseMentionItems, parseAgentMentionItems, type MentionItem } from '../mentions'
import { buildMentionRows, type MentionRow } from '../mention-rows'
import { deriveMentionMode, mentionScopeDir } from '../mention-browse-state'
import { filterBrowseItems, requestDirectory } from '../mention-browse'
import {
  initialSessionMentionLoadState, isSessionMentionQuery, loadSessionMentionPage, parseSessionQuery,
  sessionEmptyLabel, sessionItems, sessionPageLoader, sessionProjectItems, sessionProjectOptions,
  type SessionMentionLoadState,
} from '../session-mention'
import { filterSlashCommands, type SlashCommandInfo } from '../slash'
import { peekSlashCatalog, requestSlashCatalog, type SlashCatalogStatus } from '../slash-catalog'

export type MentionSearchState = {
  active: boolean
  loading: boolean
  error?: string
  /** A further page can be fetched. */
  hasMore?: boolean
  /** Phase-specific wording for an empty list. */
  emptyLabel?: string
}
const CLOSED: MentionSearchState = { active: false, loading: false }

/** Matches the desktop popup's file-search debounce. */
export const MENTION_SEARCH_DEBOUNCE_MS = 150

/** One shape for every producer, so the caller never branches on which ran. */
type MentionFetch = {
  remote: MentionItem[]
  agentProfiles: MentionItem[]
  capabilityIds?: unknown
  /** Another page is available; only the session portal pages today. */
  hasMore?: boolean
  /** What this producer's "nothing found" means, when it is not just "no matches". */
  emptyLabel?: string
}

/**
 * Where the composer's suggestions come from.
 *
 * The command catalog hangs off the project and harness, not off a session, so
 * the new-session landing gets the same overlay a live chat does. `runtimeRef`
 * still gates mention search, which needs the session's resolved cwd.
 */
export interface ComposerSuggestionSource {
  client: RefObject<RelayClient | null>
  projectPath?: string
  provider?: HarnessId
  /** Every project the host offers — the `@session` portal's scope choices. */
  projects?: readonly { path: string; name?: string }[]
  /**
   * Where fetched app icons live between searches and between runs. Injected
   * rather than imported so this hook stays free of the encrypted native store.
   */
  iconStore: MentionIconStore
}

export function useComposerSuggestions(
  runtimeRef: RefObject<ChatRuntime | null>,
  contextKey: string,
  host: ComposerSuggestionSource,
) {
  const [draft, setDraft] = useState('')
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [catalog, setCatalog] = useState<SlashCommandInfo[]>([])
  const [catalogStatus, setCatalogStatus] = useState<SlashCatalogStatus>('loading')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionFetch>({ remote: [], agentProfiles: [] })
  const [mentionSearch, setMentionSearch] = useState<MentionSearchState>(CLOSED)
  const [requestedCursor, setRequestedCursor] = useState<ComposerCursor>()
  const text = useRef('')
  const cursor = useRef<ComposerCursor>({ start: 0, end: 0 })
  const generation = useRef(0)
  const catalogGeneration = useRef(0)
  const mentionCatalog = useRef<{ agentProfiles: MentionItem[]; capabilityIds?: unknown }>({ agentProfiles: [] })
  const inFlightQuery = useRef<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  /**
   * The directory the host says it is searching. A worktree session does not
   * run in the project folder, so browsing the project would list a checkout
   * the agent cannot see.
   */
  const cwd = useRef<string | null>(null)
  /**
   * Where the session portal's scan has reached, kept per query so that asking
   * for more continues rather than re-fetching the first page.
   */
  const sessionPaging = useRef<{ query: string; state: SessionMentionLoadState; items: MentionItem[] } | null>(null)
  /**
   * App icons the device already holds, keyed by content id.
   *
   * Shared across every search and every run: the host now answers with ids,
   * and re-receiving a dozen unchanged PNGs on each keystroke was most of what
   * a mention search cost over the relay.
   */
  const icons = useRef(new MentionIconCache(host.iconStore)).current
  const [iconRevision, setIconRevision] = useState(0)

  const clear = () => {
    generation.current++
    inFlightQuery.current = null
    if (debounce.current) clearTimeout(debounce.current)
    setMentionQuery(null)
    setMentionSearch(CLOSED)
  }
  useEffect(() => {
    mentionCatalog.current = { agentProfiles: [] }
    cwd.current = null
    sessionPaging.current = null
    clear()
    return () => { generation.current++ }
  }, [contextKey])

  // Catalog load is keyed on the same context as everything else, so switching
  // project, harness or device refetches rather than showing the last one's
  // commands.
  const { projectPath, provider } = host
  useEffect(() => {
    const request = ++catalogGeneration.current
    const client = host.client.current
    if (!client || !projectPath || !provider) {
      setCatalog([])
      setCatalogStatus('ready')
      return
    }
    const cached = peekSlashCatalog(client, projectPath, provider)
    if (cached) {
      setCatalog(cached)
      setCatalogStatus('ready')
      return
    }
    setCatalog([])
    setCatalogStatus('loading')
    void requestSlashCatalog(client, projectPath, provider).then((commands) => {
      if (request !== catalogGeneration.current) return
      setCatalog(commands)
      setCatalogStatus('ready')
    }).catch(() => {
      if (request !== catalogGeneration.current) return
      setCatalog([])
      setCatalogStatus('error')
    })
    return () => { catalogGeneration.current++ }
    // `contextKey` also covers the connected device, which the two values below
    // cannot express on their own.
  }, [contextKey, projectPath, provider])

  /**
   * Derived rather than stored, so a catalog that lands *after* the user typed
   * `/` still opens the overlay. The old code only recomputed on keystrokes and
   * silently showed nothing until the next one.
   */
  const slashHits = useMemo(
    () => (slashDismissed ? [] : filterSlashCommands(draft, catalog, provider)),
    [draft, catalog, provider, slashDismissed],
  )

  const carried = () => ({
    agentProfiles: mentionCatalog.current.agentProfiles,
    capabilityIds: mentionCatalog.current.capabilityIds,
  })
  const absorb = (result: MentionSearchResult): MentionFetch => {
    if (typeof result.cwd === 'string' && result.cwd) cwd.current = result.cwd
    const agentProfiles = parseAgentMentionItems(result.agentTargets)
    mentionCatalog.current = { agentProfiles, capabilityIds: result.capabilityIds }
    return { remote: parseMentionItems(result.items), agentProfiles, capabilityIds: result.capabilityIds }
  }
  const browseRoot = (runtime: ChatRuntime | null) => cwd.current || runtime?.mentionRoot || projectPath || ''

  const sessionProjects = () => sessionProjectOptions(host.projects ?? [], projectPath ?? null)

  /**
   * The `@session` portal: pick a scope, then search titles inside it.
   *
   * Paging is continued rather than restarted when the query is unchanged, so
   * "load more" adds a page instead of re-fetching the first one. A title
   * search may skip most of a page, so the scan can cross several.
   */
  const sessionLookup = (query: string, client: RelayClient | null): (() => Promise<MentionFetch>) | null => {
    const projects = sessionProjects()
    const parsed = parseSessionQuery(query, projects, projectPath ?? null)
    if (!parsed) return null
    if (parsed.phase === 'pick-project') {
      return async () => ({
        remote: sessionProjectItems(projects, parsed.projectToken, projectPath ?? null),
        ...carried(),
        emptyLabel: sessionEmptyLabel(parsed.phase),
      })
    }
    const scope = parsed.scope
    if (!scope || !client) return null
    return async () => {
      const previous = sessionPaging.current?.query === query ? sessionPaging.current : null
      const state = previous?.state ?? initialSessionMentionLoadState()
      const { rows, next } = await loadSessionMentionPage({
        scope, titleQuery: parsed.titleQuery, projects, state,
        loadPage: sessionPageLoader(client, projectPath ?? ''),
      })
      const items = [...(previous?.items ?? []), ...sessionItems(rows, parsed.titleQuery)]
      sessionPaging.current = { query, state: next, items }
      return { remote: items, ...carried(), hasMore: next.hasMore, emptyLabel: sessionEmptyLabel(parsed.phase) }
    }
  }

  /**
   * Pick the producer for what the user has typed.
   *
   * A trailing `/` means *browse* — list one directory, which fuzzy search
   * cannot answer: an empty query against a scoped tree returns the first 20
   * entries of a deep crawl, not the folder's own children.
   */
  const mentionLookup = (
    query: string,
    runtime: ChatRuntime | null,
    client: RelayClient | null,
  ): (() => Promise<MentionFetch>) | null => {
    if (isSessionMentionQuery(query)) return sessionLookup(query, client)
    const mode = deriveMentionMode(query)
    if (mode.kind === 'browse') {
      const root = browseRoot(runtime)
      if (!client || !root) return null
      return async () => {
        const { items, error } = await requestDirectory(client, root, mode.dir)
        if (error) throw new Error(error)
        return { remote: items, ...carried() }
      }
    }
    const scoped = mode.scopeDir ? { scopeDir: mode.scopeDir } : {}
    const search = runtime ? () => runtime.searchMentions(mode.needle, scoped)
      : client && projectPath ? () => requestMentionSearch(client, projectPath, mode.needle, scoped) : null
    if (!search) return null
    return async () => {
      const result = await search()
      if (result.error) throw new Error(result.error)
      // A host that predates scoped search answered project-wide, and its
      // top-20 may have ranked every in-scope file out. Filtering that answer
      // would show less than the directory actually holds, so list the
      // directory instead and match inside it.
      if (mode.scopeDir && !result.appliedOptions?.scopeDir) {
        const fetched = absorb(result)
        const root = browseRoot(runtime)
        if (!client || !root) return fetched
        const { items, error } = await requestDirectory(client, root, mode.scopeDir)
        return error ? fetched : { ...fetched, remote: filterBrowseItems(items, mode.needle) }
      }
      return absorb(result)
    }
  }

  /**
   * Fetch the icons these rows reference and nothing else.
   *
   * Best-effort by design: a row whose icon never arrives keeps the generic
   * glyph it was already showing, which is what a failure should cost.
   */
  const fillIcons = (items: readonly MentionItem[], client: RelayClient | null) => {
    if (!client) return
    void icons.load().then(() => {
      const missing = icons.missing(items.flatMap((item) => (item.iconId ? [item.iconId] : [])))
      if (!missing.length) {
        // Even with nothing to fetch, the first load can supply rows that were
        // drawn before the cache was read.
        setIconRevision((current) => current + 1)
        return
      }
      return requestMentionIcons(client, missing).then((fetched) => {
        if (icons.put(fetched)) setIconRevision((current) => current + 1)
      })
    }).catch(() => { /* Icons are decoration; the rows are the answer. */ })
  }

  const searchMentions = () => {
    const runtime = runtimeRef.current
    const client = host.client.current
    const collapsed = cursor.current.start === cursor.current.end
    const query = collapsed ? extractMentionQuery(text.current, cursor.current.end) : null
    if (!query) {
      clear()
      return
    }
    setMentionQuery(query.query)
    const lookup = mentionLookup(query.query, runtime, client)
    if (!lookup) {
      setMentionResults({ remote: [], ...carried() })
      setMentionSearch({ active: true, loading: false })
      return
    }
    // Moving the caret inside an unchanged query must not refetch. Every
    // keystroke used to fire an RPC, and each one made the host re-enumerate
    // installed applications and decode their icons.
    if (inFlightQuery.current === query.query) return
    inFlightQuery.current = query.query
    const request = ++generation.current
    setMentionResults((current) => ({ ...current, ...carried() }))
    setMentionSearch({ active: true, loading: true })
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      const stale = () => request !== generation.current || runtime !== runtimeRef.current
        || (!runtime && client !== host.client.current)
      void Promise.resolve().then(lookup).then((fetched) => {
        if (stale()) return
        setMentionResults(fetched)
        setMentionSearch({ active: true, loading: false, hasMore: fetched.hasMore, emptyLabel: fetched.emptyLabel })
        fillIcons(fetched.remote, client)
      }).catch((error: unknown) => {
        if (stale()) return
        inFlightQuery.current = null
        setMentionSearch({ active: true, loading: false, error: error instanceof Error ? error.message : 'Could not load mention suggestions' })
      })
    }, MENTION_SEARCH_DEBOUNCE_MS)
  }

  /**
   * Rows are derived, so the catalog that arrives with a search result re-ranks
   * what is already on screen instead of waiting for another keystroke.
   *
   * Inside a directory the list is files only: `@src/app` is a path, and
   * offering capabilities or collaborators that happen to match `app` there
   * would be answering a question the user did not ask.
   */
  const mentionRows = useMemo<MentionRow[]>(() => {
    if (mentionQuery === null) return []
    const mode = deriveMentionMode(mentionQuery)
    const session = isSessionMentionQuery(mentionQuery)
    return buildMentionRows(session || mode.kind === 'browse' ? '' : mode.needle, {
      ...mentionResults,
      // Rows carry an icon id; the bytes come from the device's cache, which
      // may have filled in after the search returned.
      remote: mentionResults.remote.map((item) => {
        if (!item.iconId || item.iconPng) return item
        const png = icons.get(item.iconId)
        return png ? { ...item, iconPng: png } : item
      }),
      // A portal query is anchored the same way a path is: only its own rows apply.
      scoped: !!mentionScopeDir(mentionQuery) || session,
      // The desktop shows a path minus the directory already typed, so the two
      // surfaces truncate at the same place.
      ...(session ? {} : { scopeDir: mentionScopeDir(mentionQuery) }),
    })
    // `iconRevision` is what makes a late-arriving icon repaint the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionQuery, mentionResults, iconRevision])

  /**
   * The sessions group is called *Recent* until a title is typed, because until
   * then it is not a result — it is the archive's front page.
   */
  const mentionGroupLabels = useMemo<Partial<Record<string, string>>>(() => {
    if (mentionQuery === null || !isSessionMentionQuery(mentionQuery)) return {}
    const parsed = parseSessionQuery(mentionQuery, sessionProjects(), projectPath ?? null)
    return parsed?.phase === 'need-title' ? { session: 'Recent' } : {}
    // `host.projects` is stable per connection; the query is what moves.
  }, [mentionQuery, projectPath])

  /** Any edit the user made re-arms a dismissed overlay; a programmatic one does not. */
  const observe = (value: string, composing: boolean) => {
    setDraft(value)
    setSlashDismissed(false)
    setRequestedCursor(undefined)
    if (composing) clear()
    else searchMentions()
  }

  const update = (value: string) => {
    cursor.current = cursorAfterEdit(text.current, value, cursor.current)
    text.current = value
    observe(value, false)
  }
  const updateNative = (value: string, selection: ComposerCursor, composing: boolean) => {
    text.current = value
    cursor.current = selection
    observe(value, composing)
  }
  const select = (selection: ComposerCursor) => {
    if (selection.start < 0 || selection.end > text.current.length) return
    // Programmatic selection is one-shot; subsequent native cursor movement and
    // IME composition must remain uncontrolled.
    setRequestedCursor(undefined)
    if (selection.start === cursor.current.start && selection.end === cursor.current.end) return
    cursor.current = selection
    searchMentions()
  }
  const insert = (item: MentionItem): string | undefined => {
    if (cursor.current.start !== cursor.current.end) return
    const query = extractMentionQuery(text.current, cursor.current.end)
    if (!query) return
    const value = insertMention(text.current, query, item)
    const end = cursor.current.end + value.length - text.current.length
    text.current = value
    cursor.current = { start: end, end }
    setRequestedCursor(cursor.current)
    setDraft(value)
    // A waypoint leaves the query open, so the next lookup browses where the
    // user just moved to instead of closing the overlay.
    if (item.navigateTo !== undefined) searchMentions()
    else clear()
    return value
  }
  /** Record a draft the app rewrote, without re-arming the slash overlay. */
  const applyProgrammatic = (value: string) => {
    text.current = value
    setDraft(value)
    setSlashDismissed(true)
    clear()
  }
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  return {
    slashHits, slashCatalogStatus: catalogStatus, mentionRows, mentionSearch, requestedCursor,
    mentionQuery, mentionGroupLabels,
    update, updateNative, select, insert, clear, applyProgrammatic,
    dismissSlash: () => setSlashDismissed(true),
    retry: searchMentions,
    /** Fetch the next page of an already-open list, keeping what is on screen. */
    loadMore: () => {
      inFlightQuery.current = null
      searchMentions()
    },
  }
}
