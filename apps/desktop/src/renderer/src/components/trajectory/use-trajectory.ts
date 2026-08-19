/**
 * The panel's view of one session's fold: a loaded window, kept current by
 * merging deltas, extended backwards on demand.
 *
 * The merge rules live here rather than in the panel because they are what make
 * a delta safe to apply: every entity is addressed by a stable id the fold
 * assigns (record `index`, header `index`, request `ordinal`, `turn`), so a
 * revision lands on the record it revises and a record older than the loaded
 * window is dropped instead of corrupting the window's offset.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TrajectoryDelta,
  TrajectoryProjection,
  TrajectoryRecord,
} from '@superone/shared/trajectory-types'

/** How many records one backward page loads. */
export const PAGE_SIZE = 500

/** Fetch state for one session's window. */
export type TrajectoryLoad =
  | { status: 'loading' }
  | { status: 'ready'; projection: TrajectoryProjection }
  /** The session has not run a turn, so dsh holds no log for it yet. */
  | { status: 'absent' }
  | { status: 'failed'; error: string }

/**
 * Merge one delta into a loaded window.
 *
 * Returns the same projection object when nothing landed, so a poll during an
 * idle session does not re-render the ledger.
 * @param current - the loaded window.
 * @param delta - what the fold reports changed since the window's cursor.
 * @returns the next window.
 */
export function mergeDelta(
  current: TrajectoryProjection,
  delta: TrajectoryDelta,
): TrajectoryProjection {
  let changed = current.cursor !== delta.cursor
    || current.total !== delta.total
    || current.live !== delta.live

  const records = [...current.records]
  for (const record of delta.records) {
    const position = record.index - current.firstIndex
    // A revision to a record older than the loaded window has nowhere to land;
    // the earlier page will carry its final state when it is fetched.
    if (position < 0) continue
    if (position > records.length) continue
    records[position] = record
    changed = true
  }

  const headers = [...current.headers]
  for (const header of delta.headers) {
    headers[header.index] = header
    changed = true
  }

  const requests = [...current.requests]
  for (const request of delta.requests) {
    requests[request.ordinal - 1] = request
    changed = true
  }

  const turns = [...current.turns]
  for (const turn of delta.turns) {
    const position = turns.findLastIndex((candidate) => candidate.turn === turn.turn)
    if (position === -1) turns.push(turn)
    else turns[position] = turn
    changed = true
  }

  if (!changed) return current
  return {
    ...current,
    records,
    headers,
    requests,
    turns,
    totals: delta.totals,
    total: delta.total,
    cursor: delta.cursor,
    live: delta.live,
  }
}

/**
 * Prepend one earlier page to a loaded window.
 * @param current - the loaded window.
 * @param records - the page, in ledger order.
 * @param firstIndex - the `index` of the page's first record.
 * @returns the next window.
 */
export function prependPage(
  current: TrajectoryProjection,
  records: TrajectoryRecord[],
  firstIndex: number,
): TrajectoryProjection {
  if (records.length === 0) return current
  return { ...current, records: [...records, ...current.records], firstIndex }
}

export interface TrajectoryStore {
  load: TrajectoryLoad
  /** Whether a window read is in flight. */
  refreshing: boolean
  /** Whether an earlier page is in flight. */
  paging: boolean
  /** Re-read the window from scratch, discarding the merged one. */
  refresh: () => void
  /** Load one page of records older than the loaded window. */
  loadEarlier: () => void | Promise<void>
}

/**
 * Track one session's trajectory window.
 * @param sessionId - the SuperOne session to read.
 * @returns the window and the controls that extend it.
 */
export function useTrajectory(sessionId: string): TrajectoryStore {
  const [load, setLoad] = useState<TrajectoryLoad>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [paging, setPaging] = useState(false)

  // The cursor is read by the poller and written by every merge, so it lives in
  // a ref: routing it through state would make the poll effect re-subscribe on
  // every frame of a streaming turn.
  const cursorRef = useRef<number | null>(null)
  const pagingRef = useRef(false)
  // The window's own head, for a paging request that must not read it out of a
  // state updater — an updater that fires twice would fetch the page twice.
  const firstIndexRef = useRef(0)

  const read = useCallback(async (fromCursor: number | null) => {
    setRefreshing(true)
    const result = await window.app.readDeepseekTrajectory(sessionId, fromCursor ?? undefined)
    setRefreshing(false)
    if (!result.ok) {
      // A session whose log has not appeared yet keeps whatever window it has:
      // reporting `absent` over a loaded ledger would blank a panel the user is
      // reading because one poll raced a session teardown.
      if (cursorRef.current !== null) return
      setLoad(result.reason === 'absent'
        ? { status: 'absent' }
        : { status: 'failed', error: result.error })
      return
    }
    if (result.kind === 'full') {
      cursorRef.current = result.trajectory.cursor
      firstIndexRef.current = result.trajectory.firstIndex
      setLoad({ status: 'ready', projection: result.trajectory })
      return
    }
    cursorRef.current = result.delta.cursor
    setLoad((current) => current.status === 'ready'
      ? { status: 'ready', projection: mergeDelta(current.projection, result.delta) }
      : current)
  }, [sessionId])

  const refresh = useCallback(() => {
    cursorRef.current = null
    void read(null)
  }, [read])

  useEffect(() => {
    cursorRef.current = null
    setLoad({ status: 'loading' })
    void read(null)
  }, [read])

  // Follow the session log itself, not the agent event stream: the records a
  // trajectory exists to show — the prompt snapshot, injected context, a preset
  // selection, an approval — produce no agent event, so a panel driven by that
  // stream would sit still through an approval wait and never see a preset
  // switch made between turns. The main process throttles the signal; this side
  // only guards against overlapping reads.
  const readingRef = useRef(false)
  useEffect(() => {
    const off = window.app.onDeepseekTrajectoryChanged((changed) => {
      if (changed !== sessionId || readingRef.current) return
      readingRef.current = true
      void read(cursorRef.current).finally(() => {
        readingRef.current = false
      })
    })
    void window.app.watchDeepseekTrajectory(sessionId, true)
    return () => {
      off()
      void window.app.watchDeepseekTrajectory(sessionId, false)
    }
  }, [sessionId, read])

  const loadEarlier = useCallback(async () => {
    if (pagingRef.current || firstIndexRef.current <= 1) return
    pagingRef.current = true
    setPaging(true)
    const result = await window.app.readDeepseekTrajectoryPage(sessionId, firstIndexRef.current, PAGE_SIZE)
    pagingRef.current = false
    setPaging(false)
    if (!result.ok || result.page.records.length === 0) return
    firstIndexRef.current = result.page.firstIndex
    setLoad((latest) => latest.status === 'ready'
      ? {
        status: 'ready',
        projection: prependPage(latest.projection, result.page.records, result.page.firstIndex),
      }
      : latest)
  }, [sessionId])

  return { load, refreshing, paging, refresh, loadEarlier }
}
