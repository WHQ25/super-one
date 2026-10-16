import { formatCompactDuration } from './duration-format'

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ')

/**
 * Row summary for session timer tools: Claude CronCreate / CronDelete / CronList /
 * ScheduleWakeup and Grok `scheduler_*` (normalized to Scheduler*). Null for any
 * other tool.
 */
export function scheduleToolSummary(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'CronCreate':
      return join(text(input.cron), input.recurring === false ? 'once' : '', text(input.prompt))
    case 'SchedulerCreate': {
      const interval = text(input.interval)
      return join(text(input.task_id), interval ? `every ${interval}` : '', text(input.prompt))
    }
    case 'ScheduleWakeup': {
      if (input.stop === true) return 'stop loop'
      const delay = typeof input.delaySeconds === 'number' ? `in ${formatCompactDuration(input.delaySeconds * 1000)}` : ''
      return join(delay, text(input.reason))
    }
    case 'CronDelete':
    case 'SchedulerDelete':
      return text(input.id)
    case 'CronList':
    case 'SchedulerList':
      return ''
    default:
      return null
  }
}
