/**
 * How long ago a session was active, in one unit: `m`, `h`, `d`, `w`, `mo`, `y`.
 * Under a minute is omitted. Weeks cover 7–29 days, months cover up to a year,
 * and anything older is whole years.
 */
export function formatCompactAge(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.max(1, Math.floor(days / 365))}y`
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
