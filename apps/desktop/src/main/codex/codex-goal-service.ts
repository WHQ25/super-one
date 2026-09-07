import type { CodexGoal, CodexGoalStatus } from '@superone/shared/agent-types'
import type { SessionGoal } from '@superone/shared/session-goal'
import type { CodexExperimentService } from './codex-experiment-service'

const GOAL_STATUSES: readonly CodexGoalStatus[] = [
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return null
}

function readStatus(value: unknown): CodexGoalStatus {
  return typeof value === 'string' && (GOAL_STATUSES as readonly string[]).includes(value)
    ? value as CodexGoalStatus
    : 'active'
}

export function mapCodexGoal(raw: unknown): CodexGoal | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const threadId = readString(rec.threadId)
  const objective = readString(rec.objective)
  if (!threadId || !objective) return null
  return {
    threadId,
    objective,
    status: readStatus(rec.status),
    tokenBudget: readNumber(rec.tokenBudget),
    tokensUsed: readNumber(rec.tokensUsed) ?? 0,
    timeUsedSeconds: readNumber(rec.timeUsedSeconds) ?? 0,
    createdAt: readNumber(rec.createdAt) ?? 0,
    updatedAt: readNumber(rec.updatedAt) ?? 0,
  }
}

/**
 * Project a Codex thread goal onto the harness-neutral shape.
 *
 * `CodexGoalStatus` is already the host enum, so only the units differ: Codex
 * reports seconds, the shared shape carries milliseconds.
 */
export function sessionGoalFromCodex(goal: CodexGoal | null | undefined): SessionGoal | null {
  if (!goal) return null
  return {
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.tokensUsed,
    elapsedMs: goal.timeUsedSeconds * 1000,
    tokenBudget: goal.tokenBudget,
  }
}

/**
 * True when two goals project onto the same `SessionGoal`.
 *
 * `thread/goal/get` is re-read before every goal-driven turn and again whenever
 * the composer's stream status flips, so most reads return something the
 * renderer already has. Comparing exactly the fields {@link sessionGoalFromCodex}
 * carries — timestamps never reach the renderer, so they must not count as a
 * change — keeps those reads from waking the store and every paired phone.
 */
export function sameSessionGoalProjection(a: CodexGoal | null, b: CodexGoal | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.objective === b.objective
    && a.status === b.status
    && a.tokensUsed === b.tokensUsed
    && a.timeUsedSeconds === b.timeUsedSeconds
    && a.tokenBudget === b.tokenBudget
}

export class CodexGoalService {
  constructor(private readonly codexService: CodexExperimentService) {}

  async get(projectPath: string, threadId: string): Promise<CodexGoal | null> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/get', { threadId })
      return mapCodexGoal(result.goal)
    })
  }

  async set(projectPath: string, threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null> {
    const trimmed = objective.trim()
    if (!trimmed) throw new Error('Goal objective cannot be empty')
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/set', { threadId, objective: trimmed, ...(status ? { status } : {}) })
      return mapCodexGoal(result.goal)
    })
  }

  async clear(projectPath: string, threadId: string): Promise<boolean> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/clear', { threadId })
      return typeof result.cleared === 'boolean' ? result.cleared : false
    })
  }
}
