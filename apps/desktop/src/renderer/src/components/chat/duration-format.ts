/** Format a millisecond duration as "98s" / "1m 38s", with localized units when requested. */
export function formatCompactDuration(ms: number, locale = 'en'): string {
  const totalSec = Math.round(ms / 1000)
  if (locale.toLowerCase().startsWith('zh')) {
    if (totalSec < 60) return `${totalSec}秒`
    return `${Math.floor(totalSec / 60)}分 ${totalSec % 60}秒`
  }
  if (totalSec < 60) return `${totalSec}s`
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
}
