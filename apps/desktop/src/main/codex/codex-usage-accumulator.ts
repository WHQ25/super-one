import type { CodexUsageInfo, UsageInfo } from '@superone/shared/agent-types'

export class CodexTurnUsageAccumulator {
  private readonly lastUsageByThread = new Map<string, CodexUsageInfo>()
  private total: UsageInfo = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  }

  add(threadId: string, next: CodexUsageInfo): boolean {
    const previous = this.lastUsageByThread.get(threadId)
    if (
      previous
      && previous.totalInputTokens === next.totalInputTokens
      && previous.totalCachedInputTokens === next.totalCachedInputTokens
      && previous.totalCacheWriteInputTokens === next.totalCacheWriteInputTokens
      && previous.totalOutputTokens === next.totalOutputTokens
    ) {
      return false
    }
    this.total = {
      inputTokens: this.total.inputTokens + Math.max(0, next.lastInputTokens - next.lastCachedInputTokens),
      outputTokens: this.total.outputTokens + next.lastOutputTokens,
      cacheReadInputTokens: this.total.cacheReadInputTokens + next.lastCachedInputTokens,
      cacheCreationInputTokens: this.total.cacheCreationInputTokens + (next.lastCacheWriteInputTokens ?? 0),
    }
    this.lastUsageByThread.set(threadId, next)
    return true
  }

  snapshot(): UsageInfo {
    return { ...this.total }
  }
}
