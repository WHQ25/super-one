import type { Locale } from '@superone/shared/agent-types'

export function formatScheduledSendTime(sendAt: number, locale: Locale): string {
  return new Date(sendAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function scheduledSendFields(sendAt: number) {
  const date = new Date(sendAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return { day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}

/** Local wall time; reject invalid dates rather than silently rolling into another day. */
export function parseScheduledSendTime(day: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const result = new Date(year!, month! - 1, date!, hour!, minute!)
  const fields = scheduledSendFields(result.getTime())
  return fields.day === day && fields.time === time ? result.getTime() : null
}
