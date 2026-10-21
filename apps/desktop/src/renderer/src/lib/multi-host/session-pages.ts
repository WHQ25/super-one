import type { SessionPageState } from './types'

const IDLE: SessionPageState = { status: 'idle', error: null, sessions: [], hasMore: false }

export function emptySessionPage(): SessionPageState {
  return { ...IDLE, sessions: [] }
}

/** Keep rows already on screen while a refresh is in flight. */
export function beginSessionLoad(page: SessionPageState | undefined): SessionPageState {
  if (page?.status === 'loading') return page
  return {
    status: 'loading',
    error: null,
    sessions: page?.sessions ?? [],
    hasMore: page?.hasMore ?? false,
  }
}

export function mergeRowsById<T extends { sessionId: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((row) => row.sessionId))
  const next = existing.slice()
  for (const row of incoming) {
    if (seen.has(row.sessionId)) continue
    seen.add(row.sessionId)
    next.push(row)
  }
  return next
}

export function commitSessionPage<T extends { sessionId: string }>(
  page: SessionPageState,
  incoming: T[],
  hasMore: boolean,
  append: boolean,
): SessionPageState {
  const sessions = append ? mergeRowsById(page.sessions, incoming) : incoming
  return { status: 'ready', error: null, sessions, hasMore }
}

export function failSessionPage(page: SessionPageState | undefined, error: string): SessionPageState {
  return {
    status: 'error',
    error,
    sessions: page?.sessions ?? [],
    hasMore: page?.hasMore ?? false,
  }
}
