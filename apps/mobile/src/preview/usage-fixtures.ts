import type { RemoteUsage } from '@superone/shared/agent-types'

const now = Date.now()
export const inSeconds = (seconds: number) => Math.round(now / 1000) + seconds

/** One meter per source the host can answer with; the panel states worth reviewing live here. */
export const USAGE_FIXTURES = {
  claude: {
    kind: 'claude', title: 'Claude', account: 'dev@example.com', planType: 'Max 5x', fetchedAt: now - 2 * 60_000,
    extraUsage: { usedDollars: 3.25, limitDollars: 50 },
    windows: [
      { label: '5h', usedPercent: 37, resetsAt: inSeconds(2 * 3600 + 15 * 60) },
      { label: 'Weekly', usedPercent: 12, resetsAt: inSeconds(4 * 86_400 + 3 * 3600) },
      { label: 'Opus weekly', usedPercent: 78, resetsAt: inSeconds(4 * 86_400 + 3 * 3600) },
    ],
  },
  codex: {
    kind: 'codex', title: 'Codex', account: 'dev@example.com', planType: 'plus', extraUsage: null, fetchedAt: now,
    windows: [{ label: '5h', usedPercent: 82, resetsAt: inSeconds(40 * 60) }, { label: '7d', usedPercent: 55, resetsAt: inSeconds(3 * 86_400) }],
    resetCredits: 2,
    resetCreditList: [
      { id: 'rc-1', status: 'available', title: 'Weekly bonus reset', description: null, expiresAt: inSeconds(5 * 86_400) },
      { id: 'rc-2', status: 'redeeming', title: null, description: null, expiresAt: null },
    ],
    codexAccount: {
      lifetimeTokens: 48_200_000, peakDailyTokens: 2_100_000, longestRunningTurnSec: 1_240, currentStreakDays: 12, longestStreakDays: 30,
      threadUsage: { threadId: 't', estimatedUsageCreditsMicros: 1_250_000, estimatedUsageUsdMicros: null,
        groups: [{ model: 'gpt-5', reasoningEffort: 'high', speed: null, estimatedUsageCreditsMicros: 1_250_000, netNewInputTokens: 4_000, cachedInputTokens: 1_000, inputTokens: 5_000, outputTokens: 2_000, totalTokens: 7_000 }] },
    },
  },
  grok: {
    kind: 'acp', title: 'Grok Build', account: null, planType: 'SuperGrok', extraUsage: { usedDollars: 0.8, limitDollars: 10 },
    creditBalanceDollars: 14.2, fetchedAt: now - 45 * 60_000,
    windows: [{ label: 'Weekly limit', usedPercent: 93, resetsAt: inSeconds(86_400) }],
  },
  glm: {
    kind: 'provider', title: 'GLM', account: null, planType: 'Coding Plan Pro', extraUsage: null, fetchedAt: now,
    windows: [{ label: 'Session', usedPercent: 20, resetsAt: inSeconds(3 * 3600) }, { label: 'Weekly', usedPercent: 60, resetsAt: null }, { label: 'Web Searches', usedPercent: 5, resetsAt: null }],
  },
} satisfies Record<string, RemoteUsage>
