/**
 * Native harnesses (Codex, OpenCode) finish an OAuth sign-in on a loopback
 * listener of the machine they run on. When the user's browser is on another
 * machine, the callback is captured there and forwarded to that listener.
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

/** The attempt's loopback `redirect_uri`, or null when it has none. */
export function loopbackOAuthRedirect(authorizeUrl: string): URL | null {
  const redirect = URL.canParse(authorizeUrl) ? new URL(authorizeUrl).searchParams.get('redirect_uri') : null
  const url = redirect && URL.canParse(redirect) ? new URL(redirect) : null
  return url?.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname) ? url : null
}

/** A callback captured elsewhere, checked against the attempt's loopback redirect and `state`. */
export function validateLoopbackOAuthCallback(authorizeUrl: string, callback: string): URL {
  const expected = loopbackOAuthRedirect(authorizeUrl)
  if (!expected) throw new Error('This sign-in method does not provide a transferable callback URL')
  const received = URL.canParse(callback) ? new URL(callback) : null
  if (
    !received ||
    received.origin !== expected.origin ||
    received.pathname !== expected.pathname ||
    received.username ||
    received.password ||
    received.hash
  )
    throw new Error('Paste the complete callback URL from this sign-in attempt')
  if (!received.searchParams.has('code') && !received.searchParams.has('error'))
    throw new Error('The callback URL contains no authorization result')
  const authorize = new URL(authorizeUrl)
  if (authorize.searchParams.has('state') && received.searchParams.get('state') !== authorize.searchParams.get('state'))
    throw new Error('The callback URL belongs to another sign-in attempt')
  return received
}
