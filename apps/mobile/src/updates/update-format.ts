/**
 * Display strings for the update surfaces.
 *
 * These are deliberately *not* translated: `t()` takes a whole English source
 * string and has no interpolation, so anything carrying a number has to be its
 * own `<Text>` beside a static, translatable sentence. Keeping the numeric
 * fragments here means the i18n maps only ever hold real prose.
 */

/** `1.1.0 (48)` -- the pair a tester reads back when reporting a bug. */
export function formatBuildLabel(version: string | null, buildCode: number | null): string {
  if (!version && buildCode === null) return '—'
  if (buildCode === null) return version ?? '—'
  if (!version) return `(${buildCode})`
  return `${version} (${buildCode})`
}

/**
 * `92 MB`, decimal megabytes.
 *
 * Decimal rather than binary because this number sits next to a download and
 * every OS download UI a user has seen quotes decimal.
 */
export function formatUpdateSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const mb = bytes / 1_000_000
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** `45%`, or an em dash while the total is unknown. */
export function formatDownloadPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—'
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
}
