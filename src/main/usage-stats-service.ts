import type { CodexUsageInfo, MessageMetadata, ModelUsageInfo } from '../shared/agent-types'
import { getDb } from './database'

export type HarnessKind = 'claude' | 'codex'

export interface UsageDailyRow {
  day: string
  harness: HarnessKind
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

export interface UsageStepDelta {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface UsageQueryRange {
  from?: string
  to?: string
}

export interface UsageQueryResult {
  rows: UsageDailyRow[]
}

const BACKFILL_KEY = 'usage_backfill_done'
const BACKFILL_VERSION = 'v1'

export function localDay(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function upsert(
  day: string,
  harness: HarnessKind,
  model: string,
  delta: UsageStepDelta,
): void {
  if (!day) return
  if (
    delta.inputTokens === 0
    && delta.outputTokens === 0
    && delta.cacheReadTokens === 0
    && delta.cacheCreationTokens === 0
  ) return
  getDb().prepare(`
    INSERT INTO usage_daily (day, harness, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, harness, model) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens
  `).run(
    day,
    harness,
    model,
    delta.inputTokens,
    delta.outputTokens,
    delta.cacheReadTokens,
    delta.cacheCreationTokens,
  )
}

export function recordClaudeFromMetadata(
  metadata: MessageMetadata | undefined,
  createdAt: string | number | Date,
): void {
  const day = localDay(createdAt)
  if (!day || !metadata) return
  const modelUsage = metadata.modelUsage
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    for (const [model, u] of Object.entries(modelUsage)) {
      const mu = u as ModelUsageInfo
      upsert(day, 'claude', model, {
        inputTokens: mu.inputTokens ?? 0,
        outputTokens: mu.outputTokens ?? 0,
        cacheReadTokens: mu.cacheReadInputTokens ?? 0,
        cacheCreationTokens: mu.cacheCreationInputTokens ?? 0,
      })
    }
    return
  }
  const u = metadata.usage
  if (!u) return
  upsert(day, 'claude', metadata.model ?? 'claude', {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.cacheReadInputTokens ?? 0,
    cacheCreationTokens: u.cacheCreationInputTokens ?? 0,
  })
}

export function codexUsageStepDelta(usage: CodexUsageInfo): UsageStepDelta {
  return {
    inputTokens: Math.max(0, (usage.lastInputTokens ?? 0) - (usage.lastCachedInputTokens ?? 0)),
    outputTokens: usage.lastOutputTokens ?? 0,
    cacheReadTokens: usage.lastCachedInputTokens ?? 0,
    cacheCreationTokens: 0,
  }
}

export function recordCodexFromUsage(
  usage: CodexUsageInfo | null | undefined,
  model: string | undefined,
  createdAt: string | number | Date,
): void {
  if (!usage) return
  const day = localDay(createdAt)
  if (!day) return
  upsert(day, 'codex', model || 'codex', codexUsageStepDelta(usage))
}

export interface UsageCountsQueryRange extends UsageQueryRange {
  harness?: HarnessKind
}

export interface UsageCountsResult {
  sessions: number
  messages: number
}

export function queryCounts(range: UsageCountsQueryRange = {}): UsageCountsResult {
  const where: string[] = []
  const params: (string | number)[] = []
  if (range.from) {
    where.push('date(created_at) >= ?')
    params.push(range.from)
  }
  if (range.to) {
    where.push('date(created_at) <= ?')
    params.push(range.to)
  }
  if (range.harness) {
    where.push('provider_id = ?')
    params.push(range.harness)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = getDb()
  const sessionsRow = db.prepare(`
    SELECT COUNT(DISTINCT session_id) AS c FROM chat_messages ${whereSql}
  `).get(...params) as { c: number } | undefined
  const messagesRow = db.prepare(`
    SELECT COUNT(*) AS c FROM chat_messages ${whereSql}
  `).get(...params) as { c: number } | undefined
  return {
    sessions: sessionsRow?.c ?? 0,
    messages: messagesRow?.c ?? 0,
  }
}

export function queryUsage(range: UsageQueryRange = {}): UsageQueryResult {
  const where: string[] = []
  const params: (string | number)[] = []
  if (range.from) {
    where.push('day >= ?')
    params.push(range.from)
  }
  if (range.to) {
    where.push('day <= ?')
    params.push(range.to)
  }
  const sql = `
    SELECT day, harness, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
    FROM usage_daily
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY day DESC, harness, model
  `
  const rows = getDb().prepare(sql).all(...params) as UsageDailyRow[]
  return { rows }
}

export function getBackfillStatus(): 'done' | 'pending' {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(BACKFILL_KEY) as { value: string } | undefined
  return row?.value === BACKFILL_VERSION ? 'done' : 'pending'
}

function markBackfillDone(): void {
  getDb().prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(BACKFILL_KEY, BACKFILL_VERSION)
}

interface BackfillRow {
  metadata_json: string | null
  created_at: string
  provider_id: string
}

export interface BackfillSummary {
  scanned: number
  claudeRecorded: number
  codexRecorded: number
  durationMs: number
}

export function backfillFromHistory(): BackfillSummary {
  const startedAt = Date.now()
  const db = getDb()
  const rows = db.prepare(`
    SELECT metadata_json, created_at, provider_id
    FROM chat_messages
    WHERE role = 'assistant'
      AND status = 'complete'
      AND metadata_json IS NOT NULL
  `).all() as BackfillRow[]

  const upsertStmt = db.prepare(`
    INSERT INTO usage_daily (day, harness, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, harness, model) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens
  `)
  const upsertOne = (day: string, harness: HarnessKind, model: string, delta: UsageStepDelta): void => {
    if (
      delta.inputTokens === 0
      && delta.outputTokens === 0
      && delta.cacheReadTokens === 0
      && delta.cacheCreationTokens === 0
    ) return
    upsertStmt.run(
      day,
      harness,
      model,
      delta.inputTokens,
      delta.outputTokens,
      delta.cacheReadTokens,
      delta.cacheCreationTokens,
    )
  }

  let scanned = 0
  let claudeRecorded = 0
  let codexRecorded = 0
  const txn = db.transaction(() => {
    for (const raw of rows) {
      scanned++
      let metadata: MessageMetadata | null = null
      try {
        metadata = JSON.parse(raw.metadata_json ?? 'null') as MessageMetadata | null
      } catch {
        continue
      }
      if (!metadata) continue
      const day = localDay(raw.created_at)
      if (!day) continue
      const isCodex = raw.provider_id === 'codex' || !!metadata.codex
      if (isCodex) {
        const codexUsage = metadata.codex?.usage
        if (codexUsage) {
          upsertOne(day, 'codex', metadata.codex?.model || 'codex', codexUsageStepDelta(codexUsage))
          codexRecorded++
        }
        continue
      }
      const modelUsage = metadata.modelUsage
      if (modelUsage && Object.keys(modelUsage).length > 0) {
        for (const [model, u] of Object.entries(modelUsage)) {
          const mu = u as ModelUsageInfo
          upsertOne(day, 'claude', model, {
            inputTokens: mu.inputTokens ?? 0,
            outputTokens: mu.outputTokens ?? 0,
            cacheReadTokens: mu.cacheReadInputTokens ?? 0,
            cacheCreationTokens: mu.cacheCreationInputTokens ?? 0,
          })
        }
        claudeRecorded++
      } else if (metadata.usage) {
        const u = metadata.usage
        upsertOne(day, 'claude', metadata.model ?? 'claude', {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          cacheReadTokens: u.cacheReadInputTokens ?? 0,
          cacheCreationTokens: u.cacheCreationInputTokens ?? 0,
        })
        claudeRecorded++
      }
    }
  })
  txn()
  markBackfillDone()
  return {
    scanned,
    claudeRecorded,
    codexRecorded,
    durationMs: Date.now() - startedAt,
  }
}
