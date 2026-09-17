/** Format a millisecond duration as "98s" / "1m 38s" / "1h 20m 30s", with localized units when requested. */
export function formatCompactDuration(ms: number, locale = 'en'): string {
  const totalSec = Math.round(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (locale.toLowerCase().startsWith('zh')) {
    if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`
    if (totalSec < 60) return `${totalSec}秒`
    return `${minutes}分 ${seconds}秒`
  }
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (totalSec < 60) return `${totalSec}s`
  return `${minutes}m ${seconds}s`
}

/** `0:07` / `1:02:05`, the way a player's badge or a call timer reads. */
export function formatClockDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
