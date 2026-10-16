import type { HookCallbackMatcher, SessionCronSummary } from '@anthropic-ai/claude-agent-sdk'

/** Claude's own timer tools, withheld when SuperOne owns scheduling. */
export const CLAUDE_SCHEDULING_TOOLS = ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'] as const

/**
 * Session-scoped crons (CronCreate, ScheduleWakeup, /loop) are timers inside the
 * CLI process, so releasing an idle runtime silently drops them. The SDK reports
 * the live set only to the Stop hook (`session_crons`, current as of each turn
 * end); hosts keep the runtime while the latest report is non-empty.
 */
export function sessionCronsStopHook(onReport: (crons: SessionCronSummary[]) => void): HookCallbackMatcher {
  return {
    hooks: [async (input) => {
      if (input.hook_event_name === 'Stop') onReport(input.session_crons ?? [])
      return {}
    }],
  }
}

