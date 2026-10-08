import type { ChatMessage } from '@superone/shared/agent-types'
import { isCodexAsyncAnswer } from '@superone/shared/codex-async-question'

/** A fresh session needs no start time; it appears once the session is this old. */
export const SESSION_START_STAMP_AFTER_MS = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Messages that open a date separator, with the time it shows: the first message
 * once the session is old enough, then the first message of each later calendar day.
 * System rows (compaction, model fallback, plugin notices) and hidden Codex
 * async answers never open one.
 */
export function dateSeparators(messages: readonly ChatMessage[], now: number): Map<string, number> {
  const out = new Map<string, number>()
  let prevDay: number | null = null
  for (const message of messages) {
    if (message.providerId === 'system' || isCodexAsyncAnswer(message)) continue
    const at = Date.parse(message.createdAt)
    if (!Number.isFinite(at)) continue
    const day = startOfDay(at)
    if (prevDay === null ? now - at >= SESSION_START_STAMP_AFTER_MS : day !== prevDay) out.set(message.id, at)
    prevDay = day
  }
  return out
}

export type MessageTimeWords = {
  /** Omit to print today's times as a bare clock time. */
  today?: (time: string) => string
  yesterday: (time: string) => string
}

/** "9:46 PM", "Yesterday 9:46 PM", "Wednesday 9:46 PM", "Oct 1, 9:46 PM", then with the year. */
export function formatMessageTime(at: number, now: number, locale: string, words: MessageTimeWords): string {
  const clock = { hour: 'numeric', minute: '2-digit' } as const
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS)
  const time = new Intl.DateTimeFormat(locale, clock).format(at)
  if (days === 0) return words.today ? words.today(time) : time
  if (days === 1) return words.yesterday(time)
  // Joined by hand: ICU glues zh weekday and time without a space ("星期一21:46").
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at)} ${time}`
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...clock }).format(at)
}
