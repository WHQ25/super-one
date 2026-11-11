import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  extractStepEnvelope,
  parseAntigravityStepMetadata,
  stepTotalOutputTokens,
  type AntigravityStepMetadata,
} from './antigravity-db-proto'
import { resolveAntigravityConversationDbPath } from './antigravity-db-usage'

/** Planner response. Compaction checkpoints are a different step and stay out of turn usage. */
const STEP_TYPE_PLANNER_RESPONSE = 15
/** Internal context-compaction checkpoint. agy does not announce it on session/update. */
const STEP_TYPE_COMPACTION = 23

export interface AntigravityCompactionStep {
  idx: number
  createdAtMs: number
  completedAtMs: number
  failed: boolean
  /** Context occupancy of the last planner step before this checkpoint. */
  preTokens: number
  /** Prompt size of the first planner step after this checkpoint. */
  postTokens?: number
}

export interface AntigravityCompactionWatch {
  /** Complete checkpoints already in the db are history, not a live compaction. */
  primed: boolean
  /**
   * Clock of the first turn that armed this watch. A read that lands after that
   * turn started treats checkpoints completed earlier as history.
   */
  baselineAt: number
  handled: Set<number>
  /**
   * A manual turn already drew its divider before the checkpoint row was
   * visible. The row that lands inside that turn must not draw a second one.
   */
  unmatchedManual: { startedAt: number; endedAt: number } | null
}

export function createAntigravityCompactionWatch(): AntigravityCompactionWatch {
  return { primed: false, baselineAt: 0, handled: new Set(), unmatchedManual: null }
}

/** `/compact` is a normal Antigravity prompt. Anything else that writes step 23 is automatic. */
export function antigravityCompactTrigger(text: string): 'auto' | 'manual' {
  return /^\/compact(?:\s|$)/.test(text.trim()) ? 'manual' : 'auto'
}

function plannerOccupancy(meta: AntigravityStepMetadata): number {
  const prompt = meta.inputTokens + meta.cacheReadTokens
  const output = stepTotalOutputTokens(meta)
  if (prompt <= 0 && output <= 0) return 0
  return prompt + output
}

function plannerPrompt(meta: AntigravityStepMetadata): number {
  return meta.inputTokens + meta.cacheReadTokens
}

function isBlob(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0
}

/**
 * Read compaction checkpoints and the planner steps that bracket them.
 * `null` means the db is missing or busy — the caller must not prime history off that.
 */
export function readAntigravityCompactionSteps(
  sessionId: string,
  customHome?: string,
): AntigravityCompactionStep[] | null {
  if (!sessionId || /[/\\]/.test(sessionId)) return null
  const dbPath = resolveAntigravityConversationDbPath(sessionId, customHome)
  if (!existsSync(dbPath)) return null

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 200 })
    const columns = new Set(
      (db.prepare('PRAGMA table_info(steps)').all() as Array<{ name: string }>).map((col) => col.name),
    )
    const idxCol = columns.has('idx') ? 'idx' : columns.has('step_index') ? 'step_index' : null
    if (!idxCol || !columns.has('step_type')) return []

    const select = [
      `${idxCol} AS idx`,
      'step_type',
      ...(columns.has('metadata') ? ['metadata'] : []),
      ...(columns.has('step_payload') ? ['step_payload'] : []),
      ...(columns.has('error_details') ? ['error_details'] : []),
    ].join(', ')
    const rows = db.prepare(
      `SELECT ${select} FROM steps WHERE step_type IN (?, ?) ORDER BY ${idxCol} ASC`,
    ).all(STEP_TYPE_PLANNER_RESPONSE, STEP_TYPE_COMPACTION) as Array<{
      idx: number
      step_type: number
      metadata?: Buffer | null
      step_payload?: Buffer | null
      error_details?: Buffer | null
    }>

    const parsed = rows.map((row) => {
      const payload = row.step_payload ?? null
      const envelope = payload ? extractStepEnvelope(payload) : null
      const metaBuf = row.metadata ?? envelope?.metadataBuf ?? null
      return {
        idx: row.idx,
        stepType: row.step_type,
        meta: metaBuf ? parseAntigravityStepMetadata(metaBuf) : null,
        failed: isBlob(row.error_details),
      }
    })
    const compactions = parsed.filter((row) => row.stepType === STEP_TYPE_COMPACTION)
    return compactions.map((row) => {
      let preTokens = 0
      for (const prev of parsed) {
        if (prev.idx >= row.idx || prev.stepType !== STEP_TYPE_PLANNER_RESPONSE || !prev.meta) continue
        const occupancy = plannerOccupancy(prev.meta)
        if (occupancy > 0) preTokens = occupancy
      }
      let postTokens: number | undefined
      for (const next of parsed) {
        if (next.idx <= row.idx || next.stepType !== STEP_TYPE_PLANNER_RESPONSE || !next.meta) continue
        const prompt = plannerPrompt(next.meta)
        const occupancy = plannerOccupancy(next.meta)
        if (prompt > 0) postTokens = prompt
        else if (occupancy > 0) postTokens = occupancy
        break
      }
      return {
        idx: row.idx,
        createdAtMs: row.meta?.createdAtMs ?? 0,
        completedAtMs: row.meta?.completedAtMs ?? 0,
        failed: row.failed,
        preTokens,
        ...(postTokens !== undefined ? { postTokens } : {}),
      }
    })
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      void 0
    }
  }
}

function finished(step: AntigravityCompactionStep): boolean {
  return step.failed || step.completedAtMs > 0
}

function boundaryFor(step: AntigravityCompactionStep, trigger: 'auto' | 'manual'): AgentEvent {
  const durationMs = step.createdAtMs > 0 && step.completedAtMs >= step.createdAtMs
    ? step.completedAtMs - step.createdAtMs
    : 0
  return {
    type: 'compact_boundary',
    trigger,
    preTokens: step.preTokens,
    ...(step.postTokens !== undefined ? { postTokens: step.postTokens } : {}),
    ...(durationMs > 0 ? { durationMs } : {}),
  }
}

/**
 * Record checkpoints that already exist before this session's first prompt.
 * A missing or busy db (`null`) leaves the watch unprimed so a later read can
 * still separate history from a checkpoint that finishes during the turn.
 */
export function beginAntigravityCompactionTurn(
  watch: AntigravityCompactionWatch,
  steps: readonly AntigravityCompactionStep[] | null,
  now: number,
): void {
  if (watch.baselineAt === 0) watch.baselineAt = now
  if (watch.primed || steps === null) return
  for (const step of steps) {
    if (finished(step)) watch.handled.add(step.idx)
  }
  watch.primed = true
}

function isHistorical(watch: AntigravityCompactionWatch, step: AntigravityCompactionStep): boolean {
  if (watch.primed) return false
  if (watch.baselineAt === 0) return finished(step)
  if (!finished(step)) return step.createdAtMs > 0 && step.createdAtMs < watch.baselineAt
  return step.completedAtMs < watch.baselineAt
}

function matchesUnmatchedManual(watch: AntigravityCompactionWatch, step: AntigravityCompactionStep): boolean {
  const window = watch.unmatchedManual
  if (!window) return false
  const at = step.createdAtMs || step.completedAtMs
  return at >= window.startedAt - 1000 && at <= window.endedAt + 5000
}

/**
 * Automatic compaction has no start signal: one finished checkpoint row is the
 * end. The first snapshot only records history, so reopening a session does
 * not replay old dividers. Failed and still-open rows emit nothing.
 */
export function observeAntigravityCompaction(
  watch: AntigravityCompactionWatch,
  steps: readonly AntigravityCompactionStep[] | null,
): AgentEvent[] {
  if (steps === null) return []
  const events: AgentEvent[] = []
  for (const step of steps) {
    if (watch.handled.has(step.idx) || !finished(step)) continue
    watch.handled.add(step.idx)
    if (isHistorical(watch, step) || step.failed) continue
    if (matchesUnmatchedManual(watch, step)) {
      watch.unmatchedManual = null
      continue
    }
    events.push(boundaryFor(step, 'auto'))
  }
  watch.primed = true
  return events
}

/** Manual `/compact` start. The turn itself is the start; the row is not. */
export function antigravityManualCompactStart(): AgentEvent[] {
  return [{ type: 'status_indicator', indicator: 'compacting' }]
}

/**
 * Manual `/compact` end. A checkpoint that finished during the turn supplies
 * tokens and duration. A successful turn with no row yet still closes, using
 * the turn clock. Cancel or failure clears the indicator and claims any
 * in-progress row so a later tool-call check does not draw a second divider.
 */
export function finishAntigravityManualCompaction(
  watch: AntigravityCompactionWatch,
  steps: readonly AntigravityCompactionStep[] | null,
  outcome: 'success' | 'failed',
  startedAt: number,
  now: number,
): AgentEvent[] {
  let step: AntigravityCompactionStep | null = null
  let failedRow = false
  if (steps !== null) {
    for (const row of steps) {
      if (watch.handled.has(row.idx)) continue
      if (isHistorical(watch, row)) {
        if (finished(row)) watch.handled.add(row.idx)
        continue
      }
      watch.handled.add(row.idx)
      if (!finished(row)) continue
      if (row.failed) failedRow = true
      else step = row
    }
    watch.primed = true
  }
  if (step === null && (outcome !== 'success' || failedRow)) {
    return [{
      type: 'status_indicator',
      indicator: null,
      compactResult: 'failed',
      compactError: failedRow ? 'Context compaction failed' : 'cancelled',
    }]
  }
  const durationFromStep = step && step.createdAtMs > 0 && step.completedAtMs >= step.createdAtMs
    ? step.completedAtMs - step.createdAtMs
    : 0
  const durationMs = durationFromStep > 0 ? durationFromStep : Math.max(0, now - startedAt)
  if (step === null) watch.unmatchedManual = { startedAt, endedAt: now }
  return [
    {
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: step?.preTokens ?? 0,
      ...(step?.postTokens !== undefined ? { postTokens: step.postTokens } : {}),
      ...(durationMs > 0 ? { durationMs } : {}),
    },
    { type: 'status_indicator', indicator: null, compactResult: 'success' },
  ]
}
