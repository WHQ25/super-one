import type { ChatMessage, CodexUsageInfo } from '@superone/shared/agent-types'

/**
 * Leaf module: no store/helper imports, so cycle-sensitive modules (persistence)
 * can read Codex usage without going through `codex-helpers`, which itself
 * imports `persistence`.
 */

export function hasValidCodexUsageSnapshot(usage: CodexUsageInfo | null): usage is CodexUsageInfo {
  return Boolean(
    usage
      && Number.isFinite(usage.totalInputTokens)
      && Number.isFinite(usage.totalCachedInputTokens)
      && Number.isFinite(usage.totalOutputTokens)
      && Number.isFinite(usage.lastInputTokens)
      && Number.isFinite(usage.lastCachedInputTokens)
      && Number.isFinite(usage.lastOutputTokens)
  )
}

/** Latest valid Codex usage snapshot, scanning newest-first. */
export function findLatestCodexUsage(messages: readonly ChatMessage[]): CodexUsageInfo | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i].metadata?.codex?.usage
    if (hasValidCodexUsageSnapshot(usage as CodexUsageInfo | null)) return usage as CodexUsageInfo
  }
  return null
}
