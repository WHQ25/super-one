import type {
  CodexUsageInfo,
  MessageMetadata,
  ModelUsageInfo,
} from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { extractAllAntigravityUsageRecords } from './acp/antigravity-db-usage'
import { getDb } from './database'
import {
  codexUsageStepDelta,
  codexUsageTotalDelta,
  isZeroDelta,
  localDay,
  modelUsageInfoToDelta,
  subtractDelta,
  upsertActivity,
  upsertUsage,
  usageInfoToStepDelta,
  type HarnessKind,
  type UsageStepDelta,
} from './usage-stats-service'

const BACKFILL_KEY = 'usage_backfill_done'
const BACKFILL_VERSION = 'v8'
const ANTIGRAVITY_CACHE_SUBTRACTION_FIX_ISO = '2026-11-05T08:00:00.000Z'

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
  acp_agent_id: string | null
  provider_session_id: string | null
}

export interface BackfillSummary {
  scanned: number
  claudeRecorded: number
  codexRecorded: number
  grokRecorded: number
  sessionsRecorded: number
  messagesRecorded: number
  durationMs: number
}

function harnessOf(providerId: string, metadata: MessageMetadata | null): HarnessKind {
  if (providerId.startsWith('codex') || providerId === 'codex' || metadata?.codex) return 'codex'
  if (providerId.startsWith('cursor') || providerId === 'cursor') return 'cursor'
  if (providerId.startsWith('opencode') || providerId === 'opencode') return 'opencode'
  return 'claude'
}

function sessionHarness(provider: string | null, acpAgentId: string | null): HarnessKind {
  if (provider === 'codex') return 'codex'
  if (provider === 'cursor') return 'cursor'
  if (provider === 'opencode') return 'opencode'
  if (provider === 'acp-grok' || (provider === 'acp' && isGrokAcpAgent(acpAgentId))) return 'grok'
  if (provider === 'acp-antigravity' || (provider === 'acp' && acpAgentId?.trim() === 'antigravity')) return 'antigravity'
  return 'claude'
}

function codexLegacyMessageDelta(metadata: MessageMetadata, usage: CodexUsageInfo): UsageStepDelta {
  const last = codexUsageStepDelta(usage)
  const consumed = metadata.consumedTokens
  if (!consumed) return last
  return {
    ...last,
    inputTokens: Math.max(last.inputTokens, consumed.input ?? 0),
    outputTokens: Math.max(last.outputTokens, consumed.output ?? 0),
  }
}

function hasUsageCounterReset(current: UsageStepDelta, previous: UsageStepDelta): boolean {
  return current.inputTokens < previous.inputTokens
    || current.outputTokens < previous.outputTokens
    || current.cacheReadTokens < previous.cacheReadTokens
    || current.cacheCreationTokens < previous.cacheCreationTokens
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
    const updateMessageMetadata = db.prepare('UPDATE chat_messages SET metadata_json = ? WHERE id = ?')

    const sessionRows = db.prepare(`
      SELECT id, created_at, COALESCE(NULLIF(provider, ''), 'claude') AS provider, acp_agent_id, provider_session_id
      FROM sessions
    `).all() as SessionRow[]

    let sessionsRecorded = 0
    const sessionHarnessById = new Map<string, HarnessKind>()
    const providerSessionIdBySessionId = new Map<string, string>()
    for (const s of sessionRows) {
      const day = localDay(s.created_at)
      if (!day) continue
      const harness = sessionHarness(s.provider, s.acp_agent_id)
      sessionHarnessById.set(s.id, harness)
      if (s.provider_session_id?.trim()) {
        providerSessionIdBySessionId.set(s.id, s.provider_session_id.trim())
      }
      upsertActivity(day, harness, { sessionsStarted: 1 })
      markSession.run(now, s.id)
      sessionsRecorded++
    }

    const msgRows = db.prepare(`
      SELECT id, session_id, metadata_json, created_at, provider_id, role, status
      FROM chat_messages
      ORDER BY session_id, created_at, id
    `).all() as Array<BackfillRow & { id: string; status: string }>

    let scanned = 0
    let claudeRecorded = 0
    let codexRecorded = 0
    let grokRecorded = 0
    let messagesRecorded = 0

    const claudeSessionMaxByModel = new Map<string, Map<string, UsageStepDelta>>()
    const claudeSessionLastDayByModel = new Map<string, Map<string, string>>()
    const codexThreadTotals = new Map<string, UsageStepDelta>()
    const antigravityProviderSessionsWithMsgUsage = new Set<string>()

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

      const harness = sessionHarnessById.get(raw.session_id) ?? harnessOf(raw.provider_id, metadata)
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
            const persistedTurnUsage = metadata.codex?.turnUsage
            let delta: UsageStepDelta
            if (persistedTurnUsage) {
              delta = usageInfoToStepDelta(persistedTurnUsage)
            } else {
              const currentTotal = codexUsageTotalDelta(codexUsage)
              const threadKey = `${raw.session_id}:${metadata.codex?.threadId || 'unknown'}`
              const previousTotal = codexThreadTotals.get(threadKey)
              const cumulativeDelta = previousTotal ? subtractDelta(currentTotal, previousTotal) : null
              const fallback = codexLegacyMessageDelta(metadata, codexUsage)
              delta = !previousTotal
                || hasUsageCounterReset(currentTotal, previousTotal)
                || (cumulativeDelta && isZeroDelta(cumulativeDelta) && !isZeroDelta(fallback))
                ? fallback
                : cumulativeDelta ?? fallback
              codexThreadTotals.set(threadKey, currentTotal)
            }
            upsertUsage(codexDay, 'codex', metadata.codex?.model || 'codex', delta)
            codexRecorded++
          }
        }
        continue
      }

      if (harness === 'grok' || harness === 'antigravity') {
        const usage = metadata.usage
        if (usage) {
          const rawInputTokens = usage.inputTokens ?? 0
          const outputTokens = usage.outputTokens ?? 0
          const cacheReadTokens = usage.cacheReadInputTokens ?? 0
          const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0
          const isLegacyAntigravityUnadjusted =
            harness === 'antigravity' &&
            cacheReadTokens > 0 &&
            rawInputTokens >= cacheReadTokens &&
            raw.created_at < ANTIGRAVITY_CACHE_SUBTRACTION_FIX_ISO
          const inputTokens = isLegacyAntigravityUnadjusted
            ? rawInputTokens - cacheReadTokens
            : rawInputTokens
          if (isLegacyAntigravityUnadjusted) {
            const repairedMetadata: MessageMetadata = {
              ...metadata,
              usage: {
                ...usage,
                inputTokens,
              },
            }
            updateMessageMetadata.run(JSON.stringify(repairedMetadata), raw.id)
          }
          upsertUsage(day, harness, metadata.model || harness, {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
          })
          if (harness === 'antigravity') {
            const psid = providerSessionIdBySessionId.get(raw.session_id)
            if (psid) antigravityProviderSessionsWithMsgUsage.add(psid)
          } else {
            grokRecorded++
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

    for (const rec of extractAllAntigravityUsageRecords()) {
      if (antigravityProviderSessionsWithMsgUsage.has(rec.providerSessionId)) continue
      const day = localDay(rec.createdAt)
      if (!day) continue
      upsertUsage(day, 'antigravity', rec.model || 'antigravity', {
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        cacheReadTokens: rec.cacheReadTokens,
        cacheCreationTokens: 0,
      })
    }

    return { scanned, claudeRecorded, codexRecorded, grokRecorded, sessionsRecorded, messagesRecorded }
  })

  const summary = txn() as Omit<BackfillSummary, 'durationMs'>
  markBackfillDone()
  return {
    ...summary,
    durationMs: Date.now() - startedAt,
  }
}
