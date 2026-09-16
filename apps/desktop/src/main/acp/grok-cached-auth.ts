import { GROK_AUTH_REQUIRED } from '@superone/shared/grok-auth'
import { parseGrokAuthUrl } from './acp-auth'

/** Refuse Grok's expired-token browser fallback during chat startup. */
export async function authenticateGrokCached(request: (method: string, params: Record<string, unknown>) => Promise<unknown>, methodId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const authentication = request('authenticate', { methodId })
  try {
    const fallback = async () => {
      while (!stopped) {
        const raw = await request('x.ai/auth/get_url', {}).catch(() => null)
        if (stopped) return
        if (parseGrokAuthUrl(raw)) {
          // Best effort: runtime teardown also closes the process on rejection.
          void request('x.ai/auth/cancel', {}).catch(() => {})
          throw new Error(GROK_AUTH_REQUIRED)
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    await Promise.race([
      authentication,
      ...(methodId.includes('cached') ? [fallback()] : []),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(GROK_AUTH_REQUIRED)), 15_000) }),
    ])
  } catch {
    throw new Error(GROK_AUTH_REQUIRED)
  } finally {
    stopped = true
    clearTimeout(timer)
  }
}
