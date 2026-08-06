/**
 * Shared automation schedule helpers (desktop + node parity).
 * Electron-free; depends only on croner + shared schedule types.
 */

import { Cron } from 'croner'
import type { AutomationSchedule } from '@superone/shared/agent-types'

/**
 * Compute the next run instant for a schedule.
 * - one-time: returns `runAt` as-is (ISO string)
 * - recurring: uses croner next fire time
 */
export function computeNextRunAt(schedule: AutomationSchedule): string | undefined {
  if (schedule.type === 'one-time') {
    return schedule.runAt
  }
  if (!schedule.cron) return undefined
  try {
    const job = new Cron(schedule.cron)
    const next = job.nextRun()
    return next?.toISOString()
  } catch {
    return undefined
  }
}
