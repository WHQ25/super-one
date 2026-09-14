const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Format a byte count for a person: `0 B`, `512 B`, `1.5 KB`, `3.0 GB`.
 *
 * Binary units (1024), one decimal above bytes, and non-finite or negative
 * input reads as `0 B` — a size display is never the right place to surface a
 * NaN.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}`
}
