import type { ChatMessage, CodexThreadItem, CodexUsageInfo } from '@superone/shared/agent-types'

// Pure Codex transforms shared by Desktop and mobile reducers.

export function upsertCodexItem(items: CodexThreadItem[], next: CodexThreadItem): CodexThreadItem[] {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [...items, next]
  const cloned = [...items]
  cloned[idx] = next
  return cloned
}

export function getCodexUsageStepTokens(usage: CodexUsageInfo): { input: number; output: number } {
  return {
    input: Math.max(0, usage.lastInputTokens - usage.lastCachedInputTokens),
    output: usage.lastOutputTokens,
  }
}

export function hasValidCodexUsageSnapshot(usage: CodexUsageInfo | null): usage is CodexUsageInfo {
  return Boolean(
    usage
    && Number.isFinite(usage.totalInputTokens)
    && Number.isFinite(usage.totalCachedInputTokens)
    && Number.isFinite(usage.totalOutputTokens)
    && Number.isFinite(usage.lastInputTokens)
    && Number.isFinite(usage.lastCachedInputTokens)
    && Number.isFinite(usage.lastOutputTokens),
  )
}

function isSameCodexUsageSnapshot(a: CodexUsageInfo | null, b: CodexUsageInfo | null): boolean {
  return Boolean(
    hasValidCodexUsageSnapshot(a)
    && hasValidCodexUsageSnapshot(b)
    && a.totalInputTokens === b.totalInputTokens
    && a.totalCachedInputTokens === b.totalCachedInputTokens
    && a.totalOutputTokens === b.totalOutputTokens
    && a.lastInputTokens === b.lastInputTokens
    && a.lastCachedInputTokens === b.lastCachedInputTokens
    && a.lastOutputTokens === b.lastOutputTokens,
  )
}

export function accumulateCodexFooterTokens(
  current: { input: number; output: number },
  usage: CodexUsageInfo,
  previous: CodexUsageInfo | null,
): { input: number; output: number } {
  if (!hasValidCodexUsageSnapshot(usage) || isSameCodexUsageSnapshot(usage, previous)) {
    return current
  }
  const step = getCodexUsageStepTokens(usage)
  return {
    input: current.input + step.input,
    output: current.output + step.output,
  }
}

export function getCodexContextTokens(usage: CodexUsageInfo): number {
  return usage.lastInputTokens
}

export function getCodexCompletionEventMeta(metadata: ChatMessage['metadata'] | undefined): {
  finalResponse?: string
  durationMs?: number
  threadId: string | null
  usage: CodexUsageInfo | null
  items: CodexThreadItem[]
} | null {
  const rawCodex = metadata?.codex
  if (!rawCodex || typeof rawCodex !== 'object') return null
  const codex = rawCodex as unknown as Record<string, unknown>
  return {
    finalResponse: typeof codex.finalResponse === 'string' ? codex.finalResponse : undefined,
    durationMs: typeof codex.durationMs === 'number' && Number.isFinite(codex.durationMs) ? codex.durationMs : undefined,
    threadId: typeof codex.threadId === 'string' || codex.threadId === null ? codex.threadId : null,
    usage: hasValidCodexUsageSnapshot(codex.usage as CodexUsageInfo | null) ? codex.usage as CodexUsageInfo : null,
    items: Array.isArray(codex.items) ? codex.items as CodexThreadItem[] : [],
  }
}
