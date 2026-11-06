import type { CodexReasoningItem } from '@superone/shared/agent-types'

function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Item payloads stay flat; older histories omit these times or return null. */
export function codexItemDuration(raw: Record<string, unknown>): number | undefined {
  const start = timestamp(raw.startedAtMs), end = timestamp(raw.completedAtMs)
  return start !== undefined && end !== undefined && end >= start ? end - start : undefined
}

export function withCodexReasoningTiming(item: CodexReasoningItem, raw: Record<string, unknown>): CodexReasoningItem {
  const startedAt = timestamp(raw.startedAtMs) ?? item.startedAt
  const endedAt = timestamp(raw.completedAtMs) ?? item.endedAt
  return { ...item, startedAt, endedAt: startedAt !== undefined && endedAt !== undefined ? Math.max(startedAt, endedAt) : endedAt }
}
