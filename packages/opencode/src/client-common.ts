import type { EffortLevel } from '@superone/shared/agent-types'

const effortLevels = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max'])

/** OpenCode model variants that SuperOne exposes as effort levels. */
export function openCodeEffortLevels(variantIds: string[]): EffortLevel[] {
  return variantIds.filter((value): value is EffortLevel => effortLevels.has(value as EffortLevel))
}

/** Basic auth OpenCode expects for `OPENCODE_SERVER_PASSWORD` (user `opencode`). */
export function openCodeAuthorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`
}

export class OpenCodeApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OpenCodeApiError'
  }
}

export async function detectOpenCodeProtocol(
  url: string,
  password: string | undefined,
  signal?: AbortSignal,
): Promise<'v1' | 'v2'> {
  let response: Response
  try {
    response = await fetch(`${url}/api/info`, {
      headers: password ? { Authorization: openCodeAuthorization(password) } : {},
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return 'v1'
  }
  if (response.status === 401) {
    throw new OpenCodeApiError(`OpenCode server at ${url} rejected the server password`)
  }
  try {
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return 'v1'
    const info = (await response.json()) as { version?: unknown }
    const major = typeof info.version === 'string' ? Number.parseInt(info.version, 10) : NaN
    return major >= 2 ? 'v2' : 'v1'
  } catch (error) {
    if (signal?.aborted) throw error
    return 'v1'
  }
}
