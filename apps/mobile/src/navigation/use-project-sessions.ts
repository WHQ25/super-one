import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { Project } from '../project-types'
import { flattenSessionGroups, type SessionListItem, type SessionListRow } from '../session-list-state'
import { readProjectSessions, SESSION_PAGE_SIZE } from './workspace-data'

export type ProjectSessions = {
  items: SessionListItem[]
  busy: boolean
  loadingMore: boolean
  error: string
  hasMore: boolean
  loadMore: () => void
  toggleChildren: (sessionId: string) => void
  /** Drop a row the caller just hid or deleted, without a round trip. */
  forget: (sessionId: string) => void
  /** Apply a confirmed server-side change (pin) without refetching every page. */
  patch: (sessionId: string, changes: Partial<SessionListRow>) => void
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
): ProjectSessions {
  const [rows, setRows] = useState<SessionListRow[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const generation = useRef(0)
  const path = project?.path ?? null

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
    // Without a transport the seed is all there is — an offline shell and the
    // offline preview both render the rows they were handed, not an error.
    if (!client || !path) { setBusy(false); return }
    setBusy(true)
    void read(0)
      .then((page) => {
        if (request !== generation.current) return
        setRows(page.sessions)
        setTotal(page.totalCount)
      })
      .catch((cause: unknown) => {
        if (request !== generation.current) return
        setError(cause instanceof Error ? cause.message : 'Could not load sessions')
      })
      .finally(() => { if (request === generation.current) setBusy(false) })
    return () => { generation.current++ }
    // `seed` is a render-time array; the project path is what actually changes.
  }, [client, path, read])

  const loaded = rows.length
  const fetchPage = useCallback(() => {
    const request = generation.current
    setLoadingMore(true)
    return read(loaded)
      .then((page) => {
        if (request !== generation.current) return
        setRows((current) => {
          const seen = new Set(current.map((row) => row.sessionId))
          return [...current, ...page.sessions.filter((row) => !seen.has(row.sessionId))]
        })
        // An empty page ends the list whatever the count said, so a host that
        // over-reports its total cannot leave "Show more" stuck on screen.
        setTotal(page.sessions.length ? page.totalCount : loaded)
      })
      .catch((cause: unknown) => {
        if (request === generation.current) {
          setError(cause instanceof Error ? cause.message : 'Could not load more sessions')
        }
      })
      .finally(() => { if (request === generation.current) setLoadingMore(false) })
  }, [read, loaded])

  const hasMore = loaded < total

  const items = useMemo(
    () => flattenSessionGroups(rows, expandedIds, activeSessionId),
    [rows, expandedIds, activeSessionId],
  )

  return {
    items, busy, loadingMore, error, hasMore,
    loadMore: () => { if (!loadingMore && hasMore) void fetchPage() },
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
