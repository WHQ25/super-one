import { SessionActivityContext } from './use-session-activity'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { Project } from '../project-types'
import { flattenSessionGroups, groupSessionRows, mergeActivityIntoRows, SESSION_REVEAL_STEP, type SessionListItem, type SessionListRow } from '../session-list-state'
import { readProjectSessions, SESSION_PAGE_SIZE } from './workspace-data'

/**
 * A dropped socket is reported under the device name, not as a project's list
 * failure. Painting "Not connected" inside an expanded project is a second
 * connection readout.
 */
function listErrorFrom(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : fallback
  const normalized = message.toLowerCase()
  if (normalized === 'not connected' || normalized === 'disconnected') return ''
  return message
}

export type ProjectSessions = {
  items: SessionListItem[]
  busy: boolean
  /**
   * The first read has settled, one way or another. Emptiness cannot be inferred
   * from `!busy`: `busy` only turns on inside the effect, which runs *after* the
   * first commit, so the list would paint "No sessions yet" for a frame before
   * it had asked anyone.
   */
  loaded: boolean
  loadingMore: boolean
  error: string
  hasMore: boolean
  loadMore: () => void
  toggleChildren: (sessionId: string) => void
  /** Drop a row the caller just hid or deleted, without a round trip. */
  forget: (sessionId: string) => void
  /** Apply a confirmed server-side change (pin) without refetching every page. */
  patch: (sessionId: string, changes: Partial<SessionListRow>) => void
  /**
   * Re-read what is already loaded, in place: no spinner, no wipe. The drawer
   * calls this every time it opens, so a list it has seen before paints from
   * cache and is corrected a moment later rather than being cleared and fetched
   * again from scratch.
   */
  refresh: () => void
}

/**
 * Owns one project's session list: paging and collaboration expand state.
 * Search is not here — it is global and host-side, on its own screen.
 *
 * `generation` invalidates in-flight pages when the project or the connection
 * changes, so a slow response can never overwrite a newer list.
 */
export function useProjectSessions(
  client: RelayClient | null,
  project: Project | null,
  /** Rows the shell already holds for the active project; avoids an empty flash. */
  seed: SessionListRow[] = [],
  activeSessionId?: string | null,
  /**
   * False while the project row is collapsed. Attention groups still render —
   * desktop keeps those reachable without expanding the folder.
   */
  listExpanded = true,
): ProjectSessions {
  const activity = useContext(SessionActivityContext)
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  // How many groups are revealed, which is *not* how many rows are loaded: the
  // list shows six at a time the way the desktop sidebar does, over a network
  // page five times that size.
  const [revealed, setRevealed] = useState(SESSION_REVEAL_STEP)
  const generation = useRef(0)
  const path = project?.path ?? null
  // How deep the user has paged, read by `refresh` without making it a
  // dependency — the drawer holds `refresh` in an effect, and a callback that
  // changed on every row change would re-fire it.
  const loadedRef = useRef(0)

  const read = useCallback(async (offset: number) => {
    if (!client || !path) throw new Error('Not connected')
    return readProjectSessions(client, path, { limit: SESSION_PAGE_SIZE, offset })
  }, [client, path])

  useEffect(() => {
    const request = ++generation.current
    setRows(seed)
    setTotal(seed.length)
    setError('')
    setExpandedIds(new Set())
    setRevealed(SESSION_REVEAL_STEP)
    setLoaded(false)
    // Without a transport the seed is all there is — an offline shell and the
    // offline preview both render the rows they were handed, not an error.
    if (!client || !path) { setBusy(false); setLoaded(true); return }
    setBusy(true)
    void read(0)
      .then((page) => {
        if (request !== generation.current) return
        setRows(page.sessions)
        setTotal(page.totalCount)
      })
      .catch((cause: unknown) => {
        if (request !== generation.current) return
        setError(listErrorFrom(cause, 'Could not load sessions'))
      })
      .finally(() => { if (request !== generation.current) return; setBusy(false); setLoaded(true) })
    return () => { generation.current++ }
    // `seed` is a render-time array; the project path is what actually changes.
  }, [client, path, read])

  const loadedCount = rows.length
  useEffect(() => { loadedRef.current = loadedCount }, [loadedCount])

  /**
   * One request covering everything currently on screen, replacing it wholesale.
   * Merging a fresh first page into older ones cannot be done honestly: the host
   * orders by last activity, so a row that was on page 1 may now belong on
   * page 2 and no merge rule puts it back in the right place.
   */
  const refresh = useCallback(() => {
    if (!client || !path) return
    const request = generation.current
    void readProjectSessions(client, path, { limit: Math.max(loadedRef.current, SESSION_PAGE_SIZE), offset: 0 })
      .then((page) => {
        if (request !== generation.current) return
        setRows(page.sessions)
        setTotal(page.totalCount)
        setError('')
      })
      // A failed background refresh leaves the cached list alone; the user did
      // not ask for it and has nothing to retry.
      .catch(() => {})
  }, [client, path])

  const fetchPage = useCallback(() => {
    const request = generation.current
    setLoadingMore(true)
    return read(loadedCount)
      .then((page) => {
        if (request !== generation.current) return
        setRows((current) => {
          const seen = new Set(current.map((row) => row.sessionId))
          return [...current, ...page.sessions.filter((row) => !seen.has(row.sessionId))]
        })
        // An empty page ends the list whatever the count said, so a host that
        // over-reports its total cannot leave "Show more" stuck on screen.
        setTotal(page.sessions.length ? page.totalCount : loadedCount)
      })
      .catch((cause: unknown) => {
        if (request === generation.current) {
          setError(listErrorFrom(cause, 'Could not load more sessions'))
        }
      })
      .finally(() => { if (request === generation.current) setLoadingMore(false) })
  }, [read, loadedCount])

  const groupCount = useMemo(() => groupSessionRows(rows).length, [rows])
  // Either there are groups held back from the list, or the host is still
  // holding rows this client has never asked for.
  const hasMore = groupCount > revealed || loadedCount < total

  const items = useMemo(
    () => flattenSessionGroups(
      mergeActivityIntoRows(rows, activity, path),
      expandedIds,
      activeSessionId,
      listExpanded ? revealed : 0,
    ),
    [rows, activity, path, expandedIds, activeSessionId, listExpanded, revealed],
  )

  return {
    items, busy, loaded, loadingMore, error, hasMore: listExpanded && hasMore, refresh,
    loadMore: () => {
      if (loadingMore || !hasMore) return
      const next = revealed + SESSION_REVEAL_STEP
      // Reveal is free until it runs past the loaded rows; only then does it
      // cost a round trip, and the page it fetches covers several more reveals.
      if (groupCount < next && loadedCount < total) {
        void fetchPage().then(() => setRevealed(next))
        return
      }
      setRevealed(next)
    },
    toggleChildren: useCallback((sessionId: string) => setExpandedIds((current) => {
      const next = new Set(current)
      if (!next.delete(sessionId)) next.add(sessionId)
      return next
    }), []),
    patch: useCallback((sessionId: string, changes: Partial<SessionListRow>) => {
      setRows((current) => current.map((row) => row.sessionId === sessionId ? { ...row, ...changes } : row))
    }, []),
    forget: useCallback((sessionId: string) => {
      setRows((current) => {
        const next = current.filter((row) => row.sessionId !== sessionId)
        if (next.length !== current.length) setTotal((count) => Math.max(next.length, count - 1))
        return next
      })
    }, []),
  }
}
