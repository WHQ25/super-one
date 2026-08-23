/**
 * Wall-clock helpers for the composer's scheduled send.
 *
 * Kept apart from the control because the tricky parts — which *day* a bare
 * `HH:MM` means, and how much of an instant is worth showing — are pure
 * arithmetic worth testing on their own.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** `HH:MM` in local time, the value shape an `<input type="time">` expects. */
export function toTimeInputValue(epochMs: number): string {
  const at = new Date(epochMs)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Apply an `HH:MM` field to the day `epochMs` already names.
 *
 * A time that lands in the past is rolled a day forward: scheduling backwards
 * makes the row due on arrival and fire on the very next poll. The roll is not
 * hidden — the date field shows the day it moved to.
 */
export function withTime(epochMs: number, value: string, nowMs: number): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  const at = new Date(epochMs)
  at.setHours(hours, minutes, 0, 0)
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1)
  return at.getTime()
}

/** Move the instant to another day, keeping the time of day already chosen. */
export function withDate(epochMs: number, day: Date): number {
  const at = new Date(epochMs)
  at.setFullYear(day.getFullYear(), day.getMonth(), day.getDate())
  return at.getTime()
}

/** 24h wall-clock. Absolute rather than a countdown — easier to plan around. */
export function formatSendTime(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs))
}

/** Short calendar day, for the date field and for instants beyond today. */
export function formatSendDay(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(epochMs))
}

/**
 * How the instant reads in one line.
 *
 * A bare `14:30` is only unambiguous today; a quota window that reopens tomorrow
 * morning would otherwise read as half an hour ago. The day is added exactly
 * when it carries information.
 */
export function formatSendWhen(epochMs: number, nowMs: number): string {
  const at = new Date(epochMs)
  if (isSameDay(at, new Date(nowMs))) return formatSendTime(epochMs)
  return `${formatSendDay(epochMs)} ${formatSendTime(epochMs)}`
}
