import type { HookCallbackMatcher, SessionCronSummary } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, SessionSchedule } from '@superone/shared/agent-types'

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

/**
 * The latest `session_crons` report of one CLI process. Every turn end reports the
 * full set; only a change reaches the chat as `session_schedules`.
 */
export class SessionScheduleTracker {
  private schedules: SessionSchedule[] = []

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get hasPending(): boolean {
    return this.schedules.length > 0
  }

  report(next: SessionSchedule[]): void {
    const same = next.length === this.schedules.length
      && next.every((s, i) => s.id === this.schedules[i]?.id)
    this.schedules = next
    if (!same) this.emit({ type: 'session_schedules', schedules: next })
  }

  /** The process is gone and its timers with it; `silent` when nobody is listening any more. */
  clear(silent = false): void {
    if (silent) this.schedules = []
    else this.report([])
  }
}
