import type { CodexGoal, CodexGoalStatus } from '@superone/shared/agent-types'
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

function mapGoal(raw: unknown): CodexGoal | null {
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

export class CodexGoalService {
  constructor(private readonly codexService: CodexExperimentService) {}

  async get(projectPath: string, threadId: string): Promise<CodexGoal | null> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/get', { threadId })
      return mapGoal(result.goal)
    })
  }

  async set(projectPath: string, threadId: string, objective: string): Promise<CodexGoal | null> {
    const trimmed = objective.trim()
    if (!trimmed) throw new Error('Goal objective cannot be empty')
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/set', { threadId, objective: trimmed })
      return mapGoal(result.goal)
    })
  }

  async clear(projectPath: string, threadId: string): Promise<boolean> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request('thread/goal/clear', { threadId })
      return typeof result.cleared === 'boolean' ? result.cleared : false
    })
  }
}
