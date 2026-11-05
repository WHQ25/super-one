import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  extractStepEnvelope,
  parseAntigravityPlannerResponse,
  parseAntigravityStepMetadata,
  type AntigravityPlannerResponse,
  type AntigravityStepMetadata,
} from './antigravity-db-proto'
import { resolveAntigravityProfileDir } from './antigravity-profile'

export {
  parseAntigravityPlannerResponse,
  parseAntigravityStepMetadata,
  type AntigravityPlannerResponse,
  type AntigravityStepMetadata,
}

export interface AntigravityThinkingStep {
  stepIndex: number
  startedAt: number
  endedAt: number
  thoughtsTokens: number
  thinkingText: string
}

export interface AntigravityTurnSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  contextTokens: number
  contextWindow: number
  model: string
  thinkingSteps: AntigravityThinkingStep[]
}

export interface AntigravityHistoricalUsageRecord {
  providerSessionId: string
  createdAt: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface AntigravityWireTurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  thoughtsTokens: number
  contextTokens: number
  contextWindow: number
  model: string
}

export function mergeWireTurnUsage(
  base: AntigravityWireTurnUsage | null | undefined,
  incoming: AntigravityWireTurnUsage | null | undefined,
): AntigravityWireTurnUsage | null {
  if (!base && !incoming) return null
  if (!base) return incoming ?? null
  if (!incoming) return base
  return {
    inputTokens: Math.max(base.inputTokens, incoming.inputTokens),
    outputTokens: Math.max(base.outputTokens, incoming.outputTokens),
    cacheReadTokens: Math.max(base.cacheReadTokens, incoming.cacheReadTokens),
    thoughtsTokens: Math.max(base.thoughtsTokens, incoming.thoughtsTokens),
    contextTokens: incoming.contextTokens > 0 ? incoming.contextTokens : base.contextTokens,
    contextWindow: incoming.contextWindow > 0 ? incoming.contextWindow : base.contextWindow,
    model: incoming.model || base.model,
  }
}

export function extractAntigravityWireTurnUsage(update: unknown): AntigravityWireTurnUsage | null {
  if (!update || typeof update !== 'object') return null
  const u = update as {
    used?: unknown
    size?: unknown
    _meta?: Record<string, unknown> | null
    field_meta?: Record<string, unknown> | null
  }
  const used = typeof u.used === 'number' && u.used > 0 ? u.used : 0
  const size = typeof u.size === 'number' && u.size > 0 ? u.size : 0
  const meta = u._meta ?? u.field_meta
  const agy =
    meta && typeof meta.antigravityTurnUsage === 'object' && meta.antigravityTurnUsage !== null
      ? (meta.antigravityTurnUsage as Record<string, unknown>)
      : null
  const inputTokens = agy && typeof agy.inputTokens === 'number' && agy.inputTokens > 0 ? agy.inputTokens : 0
  const outputTokens = agy && typeof agy.outputTokens === 'number' && agy.outputTokens > 0 ? agy.outputTokens : 0
  const cacheReadTokens =
    agy && typeof agy.cacheReadTokens === 'number' && agy.cacheReadTokens > 0 ? agy.cacheReadTokens : 0
  const thoughtsTokens =
    agy && typeof agy.thoughtsTokens === 'number' && agy.thoughtsTokens > 0 ? agy.thoughtsTokens : 0
  const contextTokens =
    agy && typeof agy.contextTokens === 'number' && agy.contextTokens > 0 ? agy.contextTokens : used
  const contextWindow =
    agy && typeof agy.contextWindow === 'number' && agy.contextWindow > 0 ? agy.contextWindow : size
  const model = agy && typeof agy.model === 'string' ? agy.model.trim() : ''
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && contextTokens <= 0) {
    return null
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    thoughtsTokens,
    contextTokens,
    contextWindow,
    model,
  }
}

export function extractAntigravityPromptResponseUsage(response: unknown): AntigravityWireTurnUsage | null {
  if (!response || typeof response !== 'object') return null
  const usage = (response as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const num = (camel: string, snake: string): number => {
    const val = u[camel] ?? u[snake]
    return typeof val === 'number' && val > 0 ? val : 0
  }
  const rawInputTokens = num('inputTokens', 'input_tokens')
  const rawOutputTokens = num('outputTokens', 'output_tokens')
  const thoughtsTokens = num('thoughtTokens', 'thought_tokens')
  const cacheReadTokens = num('cachedReadTokens', 'cached_read_tokens')
  const outputTokens = rawOutputTokens + thoughtsTokens
  const inputTokens =
    cacheReadTokens > 0 && rawInputTokens >= cacheReadTokens
      ? rawInputTokens - cacheReadTokens
      : rawInputTokens
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && rawInputTokens <= 0) {
    return null
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    thoughtsTokens,
    contextTokens: 0,
    contextWindow: 0,
    model: '',
  }
}

const STEP_TYPE_USER_INPUT = 14
const STEP_TYPE_PLANNER_RESPONSE = 15

function stepTotalOutputTokens(meta: AntigravityStepMetadata): number {
  if (meta.candidatesTokens > 0 && meta.outputTokens >= meta.candidatesTokens + meta.thoughtsTokens) {
    return meta.outputTokens
  }
  return meta.outputTokens + meta.thoughtsTokens
}

function readNormalizedPlannerStepsForCurrentTurn(db: Database.Database): Array<{
  stepIndex: number
  meta: AntigravityStepMetadata | null
  payload: AntigravityPlannerResponse | null
}> {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(steps)').all() as Array<{ name: string }>).map((col) => col.name),
  )

  const idxCol = columns.has('idx') ? 'idx' : columns.has('step_index') ? 'step_index' : null
  if (!idxCol) return []

  if (columns.has('step_type')) {
    const lastUserRow = db
      .prepare(`SELECT MAX(${idxCol}) AS maxIndex FROM steps WHERE step_type = ?`)
      .get(STEP_TYPE_USER_INPUT) as { maxIndex: number | null } | undefined
    const minStepIndex = typeof lastUserRow?.maxIndex === 'number' ? lastUserRow.maxIndex : -1
    const hasMetadataCol = columns.has('metadata')
    const hasPayloadCol = columns.has('step_payload')
    const selectCols = [
      `${idxCol} AS step_index`,
      'step_type',
      ...(hasPayloadCol ? ['step_payload'] : []),
      ...(hasMetadataCol ? ['metadata'] : []),
    ].join(', ')
    const rows = db
      .prepare(`SELECT ${selectCols} FROM steps WHERE ${idxCol} > ? AND step_type != ? ORDER BY ${idxCol} ASC`)
      .all(minStepIndex, STEP_TYPE_USER_INPUT) as Array<{
      step_index: number
      step_type: number
      step_payload?: Buffer | null
      metadata?: Buffer | null
    }>

    return rows.map((row) => {
      const isPlanner = row.step_type === STEP_TYPE_PLANNER_RESPONSE
      const env = isPlanner && row.step_payload ? extractStepEnvelope(row.step_payload) : null
      const metaBuf = row.metadata ?? env?.metadataBuf ?? null
      return {
        stepIndex: row.step_index,
        meta: metaBuf ? parseAntigravityStepMetadata(metaBuf) : null,
        payload: isPlanner
          ? (env?.plannerResponse ?? (row.step_payload ? parseAntigravityPlannerResponse(row.step_payload) : null))
          : null,
      }
    })
  }

  if (!columns.has('step_payload')) return []

  const allRows = db
    .prepare(`SELECT ${idxCol} AS idx, step_payload FROM steps ORDER BY ${idxCol} ASC`)
    .all() as Array<{ idx: number; step_payload: Buffer | null }>

  let minStepIndex = -1
  const decoded = allRows.map((row) => ({
    idx: row.idx,
    env: row.step_payload ? extractStepEnvelope(row.step_payload) : null,
  }))
  for (const item of decoded) {
    if (item.env?.hasUserInput && item.idx > minStepIndex) {
      minStepIndex = item.idx
    }
  }

  const result: Array<{
    stepIndex: number
    meta: AntigravityStepMetadata | null
    payload: AntigravityPlannerResponse | null
  }> = []
  for (const item of decoded) {
    if (item.idx <= minStepIndex || !item.env?.plannerResponse) continue
    result.push({
      stepIndex: item.idx,
      meta: item.env.metadataBuf ? parseAntigravityStepMetadata(item.env.metadataBuf) : null,
      payload: item.env.plannerResponse,
    })
  }
  return result
}

export function resolveAntigravityConversationDbPath(sessionId: string, customHome?: string): string {
  const safeSessionId = sessionId.trim()
  return join(resolveAntigravityProfileDir(customHome), 'antigravity-acp', 'conversations', `${safeSessionId}.db`)
}

export function extractAntigravityTurnUsageAndThinking(
  sessionId: string,
  customHome?: string,
): AntigravityTurnSummary | null {
  if (!sessionId || /[/\\]/.test(sessionId)) return null
  const dbPath = resolveAntigravityConversationDbPath(sessionId, customHome)
  if (!existsSync(dbPath)) return null

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = readNormalizedPlannerStepsForCurrentTurn(db)
    if (rows.length === 0) return null

    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let contextTokens = 0
    let contextWindow = 0
    let model = ''
    const thinkingSteps: AntigravityThinkingStep[] = []

    for (const { stepIndex, meta, payload } of rows) {
      if (meta) {
        const stepOut = stepTotalOutputTokens(meta)
        inputTokens += meta.inputTokens
        outputTokens += stepOut
        cacheReadTokens += meta.cacheReadTokens
        const stepContext = meta.inputTokens + meta.cacheReadTokens + stepOut
        if (stepContext > 0) contextTokens = stepContext
        if (meta.contextWindow > 0) contextWindow = meta.contextWindow
        if (meta.model) model = meta.model
      }

      const thoughtsTokens = meta?.thoughtsTokens ?? 0
      const thinkingText = payload?.thinkingText ?? ''
      if (thinkingText.trim().length > 0) {
        const now = Date.now()
        const startedAt = meta && meta.createdAtMs > 0 ? meta.createdAtMs : now - 1000
        let endedAt = startedAt + 1000
        if (payload && payload.thinkingDurationMs > 0) {
          endedAt = startedAt + payload.thinkingDurationMs
        } else if (meta && meta.viewableAtMs > startedAt) {
          endedAt = meta.viewableAtMs
        } else if (meta && meta.completedAtMs > startedAt) {
          endedAt = meta.completedAtMs
        } else if (thoughtsTokens > 0) {
          endedAt = startedAt + Math.max(1000, Math.round(thoughtsTokens * 15))
        }
        thinkingSteps.push({
          stepIndex,
          startedAt,
          endedAt,
          thoughtsTokens,
          thinkingText,
        })
      }
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      contextTokens,
      contextWindow,
      model,
      thinkingSteps,
    }
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

export function extractAllAntigravityUsageRecords(customHome?: string): AntigravityHistoricalUsageRecord[] {
  const convDir = join(resolveAntigravityProfileDir(customHome), 'antigravity-acp', 'conversations')
  if (!existsSync(convDir)) return []
  const records: AntigravityHistoricalUsageRecord[] = []
  let files: string[] = []
  try {
    files = readdirSync(convDir).filter((f) => f.endsWith('.db'))
  } catch {
    return []
  }

  for (const file of files) {
    const providerSessionId = file.slice(0, -3)
    const dbPath = join(convDir, file)
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      const columns = new Set(
        (db.prepare('PRAGMA table_info(steps)').all() as Array<{ name: string }>).map((col) => col.name),
      )
      const orderCol = columns.has('idx') ? 'idx' : columns.has('step_index') ? 'step_index' : 'rowid'
      const metaBuffers: Uint8Array[] = []
      if (columns.has('metadata') && columns.has('step_type')) {
        const rows = db
          .prepare(`SELECT metadata, step_payload FROM steps WHERE step_type != ? ORDER BY ${orderCol} ASC`)
          .all(STEP_TYPE_USER_INPUT) as Array<{ metadata: Buffer | null; step_payload: Buffer | null }>
        for (const row of rows) {
          if (row.metadata) metaBuffers.push(row.metadata)
          else if (row.step_payload) {
            const env = extractStepEnvelope(row.step_payload)
            if (env.metadataBuf) metaBuffers.push(env.metadataBuf)
          }
        }
      } else if (columns.has('step_payload')) {
        const rows = db
          .prepare(`SELECT step_payload FROM steps ORDER BY ${orderCol} ASC`)
          .all() as Array<{ step_payload: Buffer | null }>
        for (const row of rows) {
          if (!row.step_payload) continue
          const env = extractStepEnvelope(row.step_payload)
          if (env.plannerResponse && env.metadataBuf) metaBuffers.push(env.metadataBuf)
        }
      }
      let lastModel = ''
      for (const metaBuf of metaBuffers) {
        const meta = parseAntigravityStepMetadata(metaBuf)
        if (meta.model) lastModel = meta.model
        const out = stepTotalOutputTokens(meta)
        if (meta.inputTokens <= 0 && out <= 0 && meta.cacheReadTokens <= 0) continue
        if (meta.createdAtMs <= 0) continue
        records.push({
          providerSessionId,
          createdAt: meta.createdAtMs,
          model: meta.model || lastModel || 'antigravity',
          inputTokens: meta.inputTokens,
          outputTokens: out,
          cacheReadTokens: meta.cacheReadTokens,
        })
      }
    } catch {
      void 0
    } finally {
      try {
        db?.close()
      } catch {
        void 0
      }
    }
  }
  return records
}
