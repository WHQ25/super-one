import { useCallback, useEffect, useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { SessionListRow } from '../session-list-state'
import type { WorkspaceListCache } from '../workspace-list-cache'
import { readSettledSessions, SETTLED_PAGE_SIZE } from './workspace-data'
import { logSidebar } from '../relay-debug'

function listErrorFrom(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : fallback
  const normalized = message.toLowerCase()
  if (normalized === 'not connected' || normalized === 'disconnected') return ''
  return message
}

export type SettledSessions = {
  rows: SessionListRow[]
  total: number
  busy: boolean
  loaded: boolean
  loadingMore: boolean
  error: string
  hasMore: boolean
  loadMore: () => void | Promise<void>
  /** Drop a row the caller just unsettled or deleted, without a round trip. */
  forget: (sessionId: string) => void
}

/**
 * One project's Settled group. Folded rows stay unmounted in the section;
 * this hook still reads the first page once the project is open so the
 * heading can show the count. A collapsed project does not ask.
 */
export function useSettledSessions(options: {
  client: RelayClient | null
  path: string | null
  cache: WorkspaceListCache
  /** The project row is expanded. A collapsed project has no Settled group. */
  enabled: boolean
  visible: boolean
  listRevision: number
}): SettledSessions {
  const { client, path, cache, enabled, visible, listRevision } = options
  const cached = path ? cache.getSettled(path) : undefined
  const [rows, setRows] = useState<SessionListRow[]>(() => cached?.rows ?? [])
  const [total, setTotal] = useState(() => cached?.total ?? 0)
  const [synced, setSynced] = useState<number | null>(() => cached?.revision ?? null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(() => cached !== undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const loadedRef = useRef(0)
  const refreshing = useRef(false)

  const read = useCallback(async (offset: number, limit = SETTLED_PAGE_SIZE) => {
    if (!client || !path) throw new Error('Not connected')
    return readSettledSessions(client, path, { limit, offset })
  }, [client, path])

  useEffect(() => {
    if (!enabled) return
    const request = ++generation.current
    const held = path ? cache.getSettled(path) : undefined
    setRows(held?.rows ?? [])
    setTotal(held?.total ?? 0)
    setSynced(held?.revision ?? null)
    setError('')
    if (held) { setBusy(false); setLoaded(true); return }
    if (!client || !path) { setBusy(false); setLoaded(true); return }
    setLoaded(false)
    setBusy(true)
    const revision = cache.revisionOf(path)
    void read(0)
      .then((page) => {
        if (request !== generation.current) return
        setRows(page.sessions)
        setTotal(page.totalCount)
        setSynced(revision)
      })
      .catch((cause: unknown) => {
        if (request !== generation.current) return
        setError(listErrorFrom(cause, 'Could not load settled sessions'))
      })
      .finally(() => { if (request !== generation.current) return; setBusy(false); setLoaded(true) })
    return () => { generation.current++ }
  }, [client, path, read, enabled, cache])

  const loadedCount = rows.length
  useEffect(() => { loadedRef.current = loadedCount }, [loadedCount])

  useEffect(() => {
    if (synced === null || !path) return
    cache.storeSettled(path, { rows, total, revision: synced })
  }, [cache, path, rows, total, synced])

  const refresh = useCallback(() => {
    if (!client || !path || refreshing.current) return
    refreshing.current = true
    const request = generation.current
    const revision = cache.revisionOf(path)
    logSidebar('settled refresh', { path, revision })
    void readSettledSessions(client, path, { limit: Math.max(loadedRef.current, SETTLED_PAGE_SIZE), offset: 0 })
      .then((page) => {
        if (request !== generation.current) return
        setRows(page.sessions)
        setTotal(page.totalCount)
        setSynced(revision)
        setError('')
      })
      .catch((cause: unknown) => logSidebar('settled refresh failed', { path, reason: cause instanceof Error ? cause.message : String(cause) }))
      .finally(() => { refreshing.current = false })
  }, [client, path, cache])

  useEffect(() => {
    if (!enabled || !visible || synced === null || !path) return
    if (synced === cache.revisionOf(path)) return
    refresh()
  }, [enabled, visible, path, synced, listRevision, cache, refresh])

  const hasMore = loadedCount < total
  const loadMore = useCallback(() => {
    if (loadingMore || loadedCount >= total) return
    const request = generation.current
    setLoadingMore(true)
    return read(loadedCount)
      .then((page) => {
        if (request !== generation.current) return
        const known = new Set(rows.map((row) => row.sessionId))
        const grew = page.sessions.some((row) => !known.has(row.sessionId))
        setRows((current) => {
          const seen = new Set(current.map((row) => row.sessionId))
          return [...current, ...page.sessions.filter((row) => !seen.has(row.sessionId))]
        })
        setTotal(grew ? page.totalCount : loadedCount)
      })
      .catch((cause: unknown) => {
        if (request === generation.current) setError(listErrorFrom(cause, 'Could not load more sessions'))
      })
      .finally(() => { if (request === generation.current) setLoadingMore(false) })
  }, [loadingMore, loadedCount, total, read, rows])

  return {
    rows, total, busy, loaded, loadingMore, error, hasMore,
    loadMore,
    forget: useCallback((sessionId: string) => {
      const next = rows.filter((row) => row.sessionId !== sessionId)
      if (next.length === rows.length) return
      setRows(next)
      setTotal((count) => Math.max(next.length, count - (rows.length - next.length)))
    }, [rows]),
  }
}
