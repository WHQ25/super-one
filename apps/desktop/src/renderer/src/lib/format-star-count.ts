/** Compact star count for list rows (`1234` → `1.2k`). */
export function formatStarCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
  }
  const m = n / 1_000_000
  return `${m >= 10 ? Math.round(m) : m.toFixed(1)}m`
}
