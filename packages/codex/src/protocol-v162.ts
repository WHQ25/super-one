import type { CodexSubagentActivity, CodexTurnProvenance } from '@superone/shared/codex-metadata'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function readCodexTurnProvenance(raw: unknown, threadId: string): CodexTurnProvenance | null {
  const turn = record(raw)
  const turnId = string(turn?.id)
  if (!turnId) return null
  const rootTurnId = string(turn?.rootTurnId)
  return { threadId, turnId, ...(rootTurnId ? { rootTurnId } : turn?.rootTurnId === null ? { rootTurnId: null } : {}) }
}

/** Inline review starts a worker turn but publishes results on review/start's turn. */
export function isCodexReviewWorkerTurn(raw: unknown, reviewTurnId: string | null | undefined): boolean {
  const turn = record(raw)
  const turnId = string(turn?.id)
  return Boolean(reviewTurnId && turnId && turnId !== reviewTurnId && string(turn?.rootTurnId) === reviewTurnId)
}

export function readCodexSubagentActivity(
  raw: unknown,
  sourceThreadId: string,
  sourceTurnId?: string | null,
): CodexSubagentActivity | null {
  const item = record(raw)
  if (item?.type !== 'subAgentActivity') return null
  const id = string(item.id), agentThreadId = string(item.agentThreadId)
  const kind = item.kind
  if (!id || !agentThreadId || typeof item.agentPath !== 'string'
    || (kind !== 'started' && kind !== 'interacted' && kind !== 'interrupted' && kind !== 'completed')) return null
  const model = string(item.model), reasoningEffort = string(item.reasoningEffort)
  return { id, sourceThreadId, ...(sourceTurnId ? { sourceTurnId } : {}), agentThreadId, agentPath: item.agentPath, kind,
    ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) }
}
