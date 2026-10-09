/** Logging hook for usage readers; hosts pass their own logger, tests and silent callers omit it. */
export interface UsageLog {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

export const silentLog: UsageLog = { info: () => {}, warn: () => {} }

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** `Retry-After` as milliseconds from now: delta seconds or an HTTP date. */
export function retryAfterMs(resp: Response, nowMs = Date.now()): number | null {
  const raw = resp.headers.get('retry-after')?.trim()
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(raw)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null
}

/** `exp` of a JWT in milliseconds, or null when the token is opaque. */
export function jwtExpiresAtMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseJson(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function isoToEpochSeconds(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}
