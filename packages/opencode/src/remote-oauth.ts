import type { HarnessOperationHost } from '@superone/runtime/session'
import type { OAuthBrowserContext } from './opencode-oauth'

/** A remote node owns the native loopback callback; the controller supplies its exact URL. */
export function validateOpenCodeOAuthCallback(authorizeUrl: string, callback: string): URL {
  const authorize = new URL(authorizeUrl)
  const redirect = authorize.searchParams.get('redirect_uri')
  if (!redirect) throw new Error('This sign-in method does not provide a transferable callback URL')
  const expected = new URL(redirect),
    received = new URL(callback)
  if (
    expected.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname) ||
    received.origin !== expected.origin ||
    received.pathname !== expected.pathname ||
    received.username ||
    received.password ||
    received.hash
  )
    throw new Error('Paste the complete callback URL from this sign-in attempt')
  if (!received.searchParams.has('code') && !received.searchParams.has('error'))
    throw new Error('The callback URL contains no authorization result')
  if (authorize.searchParams.has('state') && received.searchParams.get('state') !== authorize.searchParams.get('state'))
    throw new Error('The callback URL belongs to another sign-in attempt')
  return received
}

export async function openRemoteOpenCodeSignIn(url: string, context: OAuthBrowserContext, host: HarnessOperationHost) {
  const authorize = new URL(url)
  if (!['http:', 'https:'].includes(authorize.protocol) || authorize.username || authorize.password)
    throw new Error('OpenCode returned an unsupported sign-in URL')
  host.assertControl()
  const question =
    context.mode === 'auto'
      ? `Open [the sign-in page](${url}). After sign-in, the browser may show a localhost connection error because OpenCode runs on another machine. Copy the full callback URL from the address bar and paste it here.`
      : `Open [the sign-in page](${url}), then continue to enter the authorization code.`
  const raw = await host.onQuestion(
    {
      interactionId: `opencode-open-${crypto.randomUUID()}`,
      kind: 'question',
      toolName: 'AskUserQuestion',
      input: {
        questions: [
          {
            question,
            header: context.mode === 'auto' ? 'Sign-in callback URL' : 'Open sign-in page',
            options: context.mode === 'auto' ? [] : [{ label: 'Continue', description: 'The sign-in page is open.' }],
            multiSelect: false,
          },
        ],
      },
      createdAt: Date.now(),
    },
    context.signal,
  )
  context.signal.throwIfAborted()
  host.assertControl()
  const value = Array.isArray(raw)
    ? raw[0]
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>)[question] ??
        (raw as Record<string, unknown>)['Sign-in callback URL'] ??
        (raw as Record<string, unknown>)['Open sign-in page'])
      : undefined
  const answer = Array.isArray(value) ? value[0] : value
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('OpenCode sign-in cancelled')
  if (context.mode !== 'auto') return
  const callback = validateOpenCodeOAuthCallback(url, answer.trim())
  const response = await fetch(callback, {
    redirect: 'error',
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
  })
  if (!response.ok) throw new Error('The native sign-in callback did not accept this result')
}
