/** Format token count: plain <1k, k for thousands, m from 1M up (avoid 1000.0k). */
export function formatTokens(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
