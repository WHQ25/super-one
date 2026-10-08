import type { ChatMessage } from '@superone/shared/agent-types'

/** ISO time `daysAgo` calendar days back, at a local clock time. */
export function localTime(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function timedUser(id: string, text: string, createdAt: string): ChatMessage {
  return { id, role: 'user', status: 'complete', providerId: 'user', createdAt, content: [{ type: 'text', text }] }
}

export function timedAssistant(id: string, text: string, createdAt: string, completedAt?: string): ChatMessage {
  return {
    id, role: 'assistant', status: 'complete', providerId: 'claude', createdAt,
    content: [{ type: 'text', text }],
    metadata: { durationMs: 42_000, ...(completedAt ? { completedAt } : {}) },
  }
}

/** Three days of turns: a start separator, then one per new day. */
export function multiDayTranscript(): ChatMessage[] {
  return [
    timedUser('u1', 'Why does the migration drop rows on cold start?', localTime(3, 21, 46)),
    timedAssistant('a1', 'The backfill runs before the WAL checkpoint, so the last batch is lost.', localTime(3, 21, 46), localTime(3, 21, 58)),
    timedUser('u2', 'Can you add a test for it?', localTime(1, 9, 5)),
    timedAssistant('a2', 'Added `migration-cold-start.test.ts`; it fails before the fix and passes after.', localTime(1, 9, 5), localTime(1, 9, 11)),
    timedUser('u3', 'Ship it.', localTime(0, 0, 10)),
    timedAssistant('a3', 'Committed and pushed.', localTime(0, 0, 10), localTime(0, 0, 12)),
  ]
}

/** A session started minutes ago: no start separator yet. */
export function freshTranscript(): ChatMessage[] {
  const started = new Date(Date.now() - 10 * 60_000).toISOString()
  return [
    timedUser('u1', 'Rename the session store.', started),
    timedAssistant('a1', 'Renamed.', started, new Date(Date.now() - 9 * 60_000).toISOString()),
  ]
}
