import { parseGrokAuthUrl } from './acp-auth'

export type GrokLoginAnswer =
  | { kind: 'code'; code: string }
  | { kind: 'opened' }
  | { kind: 'cancel' }

/** Authenticate owns the login attempt; get_url and submit_code only drive it. */
export async function authenticateGrokInteractively(ops: {
  authenticate: () => Promise<unknown>
  getUrl: () => Promise<unknown>
  submitCode: (code: string) => Promise<unknown>
  cancel: () => Promise<unknown>
  request: (params: { authUrl: string; mode?: string }) => Promise<GrokLoginAnswer>
}): Promise<void> {
  // Observe failures immediately, including while get_url or the UI is pending.
  const authentication = ops.authenticate().then(
    () => ({ kind: 'authenticated' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  try {
    let parsed: ReturnType<typeof parseGrokAuthUrl> = null
    for (let attempt = 0; attempt < 60 && !parsed; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50))
      const result = await Promise.race([
        authentication,
        ops.getUrl().then((raw) => ({ kind: 'url' as const, raw })),
      ])
      if (result.kind === 'failed') throw result.error
      // Cached credentials may finish authenticate without opening a browser.
      if (result.kind === 'authenticated') return
      parsed = parseGrokAuthUrl(result.raw)
    }
    if (!parsed) throw new Error('Grok login did not provide an authentication URL')
    const response = await Promise.race([
      authentication,
      ops.request({ authUrl: parsed.authUrl, mode: parsed.mode }).then((answer) => ({ kind: 'answer' as const, answer })),
    ])
    if (response.kind === 'authenticated') return
    if (response.kind === 'failed') throw response.error
    const answer = response.answer
    if (answer.kind === 'cancel') throw new Error('Grok login cancelled')
    if (answer.kind === 'code') await ops.submitCode(answer.code)
    // submit_code only acknowledges delivery, not successful authentication.
    const result = await authentication
    if (result.kind === 'failed') throw result.error
  } catch (error) {
    try { await ops.cancel() } catch { /* best-effort; runtime teardown follows */ }
    throw error
  }
}
