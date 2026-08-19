/**
 * The ledger's row model: turning a loaded window into the rows the table
 * actually mounts, with turn and request boundaries, folding, search, and the
 * timeline's range filter applied.
 *
 * Kept out of the components so the rules are testable without a DOM, and so
 * the virtualizer only ever sees a plain array.
 */

import type {
  TrajectoryProjection,
  TrajectoryRecord,
  TrajectoryRequest,
  TrajectoryTurn,
} from '@superone/shared/trajectory-types'

/** One mounted ledger row. */
export type LedgerRow =
  | { kind: 'turn'; key: string; turn: TrajectoryTurn; folded: boolean }
  /** Header for records that belong to no turn (a standalone compaction). */
  | { kind: 'between'; key: string }
  /** The boundary where one model call begins — selectable in its own right. */
  | { kind: 'request'; key: string; request: TrajectoryRequest }
  /** The interactive head of a window that does not reach the fold's start. */
  | { kind: 'earlier'; key: string }
  | { kind: 'record'; key: string; record: TrajectoryRecord }

/** Identify a step within a session, for per-message call folding. */
export function stepKey(turn: number | null, step: number | null): string {
  return `${turn ?? 'x'}:${step ?? 'x'}`
}

/**
 * The text a record is searched by, memoized on the record itself.
 *
 * A `WeakMap` keyed by the record object is the whole cache-invalidation
 * story: the fold delivers a revised record as a *new* object, so a completed
 * tool call or a decided approval re-derives exactly once and every unchanged
 * record keeps its text across re-renders and merges.
 */
const searchTexts = new WeakMap<TrajectoryRecord, string>()

/**
 * The text a record is searched by.
 *
 * Deliberately the row's own visible text plus the identifiers a user would
 * type (tool name, producer, model): searching the full payloads would match
 * inside megabytes of tool output and return rows whose visible content shows
 * no reason for the match.
 * @param record - the record to index.
 * @returns the searchable text, lowercased.
 */
export function searchTextOf(record: TrajectoryRecord): string {
  const cached = searchTexts.get(record)
  if (cached !== undefined) return cached
  const parts = [record.kind, record.summary]
  if (record.kind === 'tool') parts.push(record.name)
  if (record.kind === 'context') parts.push(record.producer, record.form ?? '')
  if (record.kind === 'message') parts.push(record.model, record.provider)
  if (record.kind === 'approval') parts.push(record.toolName, record.outcome ?? '')
  const text = parts.join(' ').toLowerCase()
  searchTexts.set(record, text)
  return text
}

export interface LedgerOptions {
  projection: TrajectoryProjection
  /** Free-text filter; empty means no filtering. */
  query: string
  /** Record ids the timeline selection admits, or `null` when unfiltered. */
  visibleIds: ReadonlySet<string> | null
  /** Turns whose records are hidden. */
  foldedTurns: ReadonlySet<number>
  /** Steps whose tool records are hidden, keyed by {@link stepKey}. */
  foldedSteps: ReadonlySet<string>
}

/**
 * Build the mounted rows for the ledger.
 *
 * Search wins over folding: a query that matches a record inside a folded turn
 * reveals it, because a filtered ledger that silently hides matches is worse
 * than one that expands to show them.
 * @param options - the loaded window plus the current view state.
 * @returns the rows, in log order.
 */
export function buildLedgerRows(options: LedgerOptions): LedgerRow[] {
  const { projection, query, visibleIds, foldedTurns, foldedSteps } = options
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const turnsByNumber = new Map(projection.turns.map((turn) => [turn.turn, turn]))

  const rows: LedgerRow[] = []
  // The head row is interactive whenever earlier history exists, so a user who
  // scrolls to the top of the window has somewhere to go.
  if (projection.firstIndex > 1) rows.push({ kind: 'earlier', key: 'earlier' })

  let openTurn: number | null | undefined
  let openRequest: number | null = null

  for (const record of projection.records) {
    if (searching && !searchTextOf(record).includes(needle)) continue
    if (visibleIds !== null && !visibleIds.has(record.id)) continue

    if (record.turn !== openTurn) {
      openTurn = record.turn
      if (record.turn === null) {
        rows.push({ kind: 'between', key: `between:${record.id}` })
      } else {
        const turn = turnsByNumber.get(record.turn)
        if (turn) {
          rows.push({
            kind: 'turn',
            key: `turn:${turn.turn}`,
            turn,
            folded: !searching && foldedTurns.has(turn.turn),
          })
        }
      }
    }

    const folded = !searching
      && record.turn !== null
      && foldedTurns.has(record.turn)

    if (record.request !== null && record.request !== openRequest) {
      openRequest = record.request
      const request = projection.requests[record.request - 1]
      // The boundary is suppressed inside a folded turn for the same reason its
      // records are: the turn row already stands for everything it contains.
      if (request && !folded) rows.push({ kind: 'request', key: `request:${request.ordinal}`, request })
    }

    if (folded) continue
    if (!searching) {
      // A folded step hides the calls the model made in it, not the message
      // that requested them — that message is the fold's own handle.
      if (record.kind === 'tool' && foldedSteps.has(stepKey(record.turn, record.step))) continue
    }

    rows.push({ kind: 'record', key: record.id, record })
  }

  return rows
}

/**
 * Every step that has at least one tool record — the steps whose calls can be
 * folded, and therefore the set a "collapse all calls" control writes.
 * @param projection - the loaded window to scan.
 * @returns the step keys.
 */
export function foldableSteps(projection: TrajectoryProjection): string[] {
  const steps = new Set<string>()
  for (const record of projection.records) {
    if (record.kind === 'tool') steps.add(stepKey(record.turn, record.step))
  }
  return [...steps]
}
