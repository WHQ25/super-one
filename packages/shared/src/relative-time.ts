type AgeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

const ageFormatters = new Map<string, Intl.NumberFormat>()

function formatAgeUnit(value: number, unit: AgeUnit, locale: string): string {
  // English narrow months render as `3m`, which reads as minutes.
  if (unit === 'month' && locale.toLowerCase().startsWith('en')) return `${value}mo`
  const key = `${locale}:${unit}`
  let formatter = ageFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' })
    ageFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

/**
 * How long ago a session was active, in one unit (`3h` in English, `3小时` in
 * Chinese). Under a minute is omitted. Weeks cover 7–29 days, months cover up
 * to a year, and anything older is whole years.
 */
export function formatCompactAge(
  iso: string,
  { locale = 'en', now = Date.now() }: { locale?: string; now?: number } = {},
): string {
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return ''
  if (minutes < 60) return formatAgeUnit(minutes, 'minute', locale)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return formatAgeUnit(hours, 'hour', locale)
  const days = Math.floor(hours / 24)
  if (days < 7) return formatAgeUnit(days, 'day', locale)
  if (days < 30) return formatAgeUnit(Math.floor(days / 7), 'week', locale)
  const months = Math.floor(days / 30)
  if (months < 12) return formatAgeUnit(months, 'month', locale)
  return formatAgeUnit(Math.max(1, Math.floor(days / 365)), 'year', locale)
}

/** Compact "3h ago" style label for list rows; not locale-aware by design. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
