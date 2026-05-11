import type { CodexUsageInfo, MessageMetadata, ModelUsageInfo } from '@superone/shared/agent-types'
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

export interface ActivityDailyRow {
  day: string
  harness: HarnessKind
  sessions_started: number
  user_messages: number
  assistant_messages: number
}

export interface UsageQueryRange {
  from?: string
  to?: string
}

export interface UsageQueryResult {
  rows: UsageDailyRow[]
}

const BACKFILL_KEY = 'usage_backfill_done'
const BACKFILL_VERSION = 'v3'

export function localDay(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isZeroDelta(delta: UsageStepDelta): boolean {
  return delta.inputTokens === 0
    && delta.outputTokens === 0
    && delta.cacheReadTokens === 0
    && delta.cacheCreationTokens === 0
}

function upsertUsage(
  day: string,
  harness: HarnessKind,
  model: string,
  delta: UsageStepDelta,
): void {
  if (!day || isZeroDelta(delta)) return
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

export function modelUsageInfoToDelta(u: ModelUsageInfo): UsageStepDelta {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.cacheReadInputTokens ?? 0,
    cacheCreationTokens: u.cacheCreationInputTokens ?? 0,
  }
}

export function subtractDelta(curr: UsageStepDelta, prev: UsageStepDelta): UsageStepDelta {
  return {
    inputTokens: Math.max(0, curr.inputTokens - prev.inputTokens),
    outputTokens: Math.max(0, curr.outputTokens - prev.outputTokens),
    cacheReadTokens: Math.max(0, curr.cacheReadTokens - prev.cacheReadTokens),
    cacheCreationTokens: Math.max(0, curr.cacheCreationTokens - prev.cacheCreationTokens),
  }
}

export function recordClaudeStepDeltas(
  perModelDelta: Record<string, UsageStepDelta>,
  createdAt: string | number | Date,
): void {
  const day = localDay(createdAt)
  if (!day) return
  for (const [model, delta] of Object.entries(perModelDelta)) {
    upsertUsage(day, 'claude', model, delta)
  }
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
  upsertUsage(day, 'codex', model || 'codex', codexUsageStepDelta(usage))
}

function upsertActivity(
  day: string,
  harness: HarnessKind,
  delta: { sessionsStarted?: number; userMessages?: number; assistantMessages?: number },
): void {
  if (!day) return
  const s = delta.sessionsStarted ?? 0
  const u = delta.userMessages ?? 0
  const a = delta.assistantMessages ?? 0
  if (s === 0 && u === 0 && a === 0) return
  getDb().prepare(`
    INSERT INTO activity_daily (day, harness, sessions_started, user_messages, assistant_messages)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day, harness) DO UPDATE SET
      sessions_started = sessions_started + excluded.sessions_started,
      user_messages = user_messages + excluded.user_messages,
      assistant_messages = assistant_messages + excluded.assistant_messages
  `).run(day, harness, s, u, a)
}

export function recordSessionStarted(harness: HarnessKind, createdAt: string | number | Date): void {
  upsertActivity(localDay(createdAt), harness, { sessionsStarted: 1 })
}

export function recordMessageCounts(
  harness: HarnessKind,
  createdAt: string | number | Date,
  delta: { userMessages?: number; assistantMessages?: number },
): void {
  upsertActivity(localDay(createdAt), harness, delta)
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
    where.push('day >= ?')
    params.push(range.from)
  }
  if (range.to) {
    where.push('day <= ?')
    params.push(range.to)
  }
  if (range.harness) {
    where.push('harness = ?')
    params.push(range.harness)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(sessions_started), 0) AS sessions,
      COALESCE(SUM(user_messages + assistant_messages), 0) AS messages
    FROM activity_daily
    ${whereSql}
  `).get(...params) as { sessions: number; messages: number } | undefined
  return {
    sessions: row?.sessions ?? 0,
    messages: row?.messages ?? 0,
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
  session_id: string
  metadata_json: string | null
  created_at: string
  provider_id: string
  role: string
}

interface SessionRow {
  id: string
  created_at: string
  provider: string | null
}

export interface BackfillSummary {
  scanned: number
  claudeRecorded: number
  codexRecorded: number
  sessionsRecorded: number
  messagesRecorded: number
  durationMs: number
}

function harnessOf(providerId: string, metadata: MessageMetadata | null): HarnessKind {
  return providerId === 'codex' || metadata?.codex ? 'codex' : 'claude'
}

export function backfillFromHistory(): BackfillSummary {
  const startedAt = Date.now()
  const db = getDb()

  const txn = db.transaction(() => {
    db.exec('DELETE FROM usage_daily')
    db.exec('DELETE FROM activity_daily')

    const now = new Date().toISOString()
    const markSession = db.prepare('UPDATE sessions SET usage_counted_at = ? WHERE id = ?')
    const markMessage = db.prepare('UPDATE chat_messages SET usage_counted_at = ? WHERE id = ?')

    const sessionRows = db.prepare(`
      SELECT id, created_at, COALESCE(NULLIF(provider, ''), 'claude') AS provider
      FROM sessions
    `).all() as SessionRow[]

    let sessionsRecorded = 0
    for (const s of sessionRows) {
      const day = localDay(s.created_at)
      if (!day) continue
      const harness: HarnessKind = s.provider === 'codex' ? 'codex' : 'claude'
      upsertActivity(day, harness, { sessionsStarted: 1 })
      markSession.run(now, s.id)
      sessionsRecorded++
    }

    const msgRows = db.prepare(`
      SELECT id, session_id, metadata_json, created_at, provider_id, role, status
      FROM chat_messages
    `).all() as Array<BackfillRow & { id: string; status: string }>

    let scanned = 0
    let claudeRecorded = 0
    let codexRecorded = 0
    let messagesRecorded = 0

    const claudeSessionMaxByModel = new Map<string, Map<string, UsageStepDelta>>()
    const claudeSessionLastDayByModel = new Map<string, Map<string, string>>()

    for (const raw of msgRows) {
      scanned++

      let metadata: MessageMetadata | null = null
      if (raw.metadata_json) {
        try {
          metadata = JSON.parse(raw.metadata_json) as MessageMetadata
        } catch {
          metadata = null
        }
      }

      const harness = harnessOf(raw.provider_id, metadata)
      const day = localDay(raw.created_at)
      if (!day) continue

      if (raw.role === 'user') {
        upsertActivity(day, harness, { userMessages: 1 })
        markMessage.run(now, raw.id)
        messagesRecorded++
      } else if (raw.role === 'assistant' && raw.status === 'complete') {
        upsertActivity(day, harness, { assistantMessages: 1 })
        markMessage.run(now, raw.id)
        messagesRecorded++
      }

      if (!metadata) continue

      if (harness === 'codex') {
        const codexUsage = metadata.codex?.usage
        if (codexUsage) {
          const codexDay = localDay(raw.created_at)
          if (codexDay) {
            upsertUsage(codexDay, 'codex', metadata.codex?.model || 'codex', codexUsageStepDelta(codexUsage))
            codexRecorded++
          }
        }
        continue
      }

      const modelUsage = metadata.modelUsage
      if (modelUsage && Object.keys(modelUsage).length > 0) {
        let perModel = claudeSessionMaxByModel.get(raw.session_id)
        let perModelDay = claudeSessionLastDayByModel.get(raw.session_id)
        if (!perModel) {
          perModel = new Map()
          claudeSessionMaxByModel.set(raw.session_id, perModel)
        }
        if (!perModelDay) {
          perModelDay = new Map()
          claudeSessionLastDayByModel.set(raw.session_id, perModelDay)
        }
        for (const [model, u] of Object.entries(modelUsage)) {
          const curr = modelUsageInfoToDelta(u as ModelUsageInfo)
          const prev = perModel.get(model)
          if (!prev || (curr.inputTokens + curr.outputTokens + curr.cacheReadTokens + curr.cacheCreationTokens)
              >= (prev.inputTokens + prev.outputTokens + prev.cacheReadTokens + prev.cacheCreationTokens)) {
            perModel.set(model, curr)
            perModelDay.set(model, day)
          }
        }
        claudeRecorded++
      }
    }

    for (const [sessionId, perModel] of claudeSessionMaxByModel) {
      const perModelDay = claudeSessionLastDayByModel.get(sessionId)
      if (!perModelDay) continue
      for (const [model, delta] of perModel) {
        const day = perModelDay.get(model)
        if (!day) continue
        upsertUsage(day, 'claude', model, delta)
      }
    }

    return { scanned, claudeRecorded, codexRecorded, sessionsRecorded, messagesRecorded }
  })

  const summary = txn() as Omit<BackfillSummary, 'durationMs'>
  markBackfillDone()
  return {
    ...summary,
    durationMs: Date.now() - startedAt,
  }
}
