import * as http from 'node:http'

export const ANTIGRAVITY_AUTH_STDOUT_PREFIX = 'Open the following link to authenticate the ACP server: '
export const ANTIGRAVITY_AUTH_STDERR_PREFIX = 'Please visit the following URL to authorize: '
export const ANTIGRAVITY_AUTH_BROWSER_MARKER = '__SUPERONE_ANTIGRAVITY_AUTH_URL__'

const LOOPBACK_REDIRECT_URI_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})\/(?:auth\/callback)?$/

export function validateAntigravityOAuthUrl(rawUrl: string): {
  authUrl: string
  redirectUri: string
  state: string
} {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('Antigravity returned an invalid Google OAuth URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'accounts.google.com' ||
    parsed.pathname !== '/o/oauth2/v2/auth' ||
    parsed.searchParams.get('response_type') !== 'code'
  ) {
    throw new Error('Antigravity returned an unexpected Google OAuth endpoint')
  }
  const state = parsed.searchParams.get('state')?.trim() ?? ''
  if (!state) {
    throw new Error('Antigravity Google OAuth URL is missing state')
  }
  const redirectUri = parsed.searchParams.get('redirect_uri')?.trim() ?? ''
  const match = LOOPBACK_REDIRECT_URI_PATTERN.exec(redirectUri)
  const port = match?.[1] ? Number(match[1]) : NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Antigravity Google OAuth URL has an invalid loopback redirect URI')
  }
  return { authUrl: parsed.toString(), redirectUri, state }
}

export function extractAntigravityAuthUrlFromStdoutLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, '')
  for (const prefix of [ANTIGRAVITY_AUTH_STDOUT_PREFIX, ANTIGRAVITY_AUTH_STDERR_PREFIX]) {
    if (trimmed.startsWith(prefix)) {
      const raw = trimmed.slice(prefix.length).trim()
      return raw || null
    }
  }
  return null
}

export function extractAntigravityAuthUrlsFromStderrChunk(chunk: string): string[] {
  const urls: string[] = []
  const pushUnique = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed && !urls.includes(trimmed)) urls.push(trimmed)
  }
  for (const line of chunk.split(/\r?\n/)) {
    const markerIdx = line.indexOf(ANTIGRAVITY_AUTH_BROWSER_MARKER)
    if (markerIdx >= 0) {
      pushUnique(line.slice(markerIdx + ANTIGRAVITY_AUTH_BROWSER_MARKER.length))
      continue
    }
    for (const prefix of [ANTIGRAVITY_AUTH_STDERR_PREFIX, ANTIGRAVITY_AUTH_STDOUT_PREFIX]) {
      const prefixIdx = line.indexOf(prefix)
      if (prefixIdx >= 0) {
        pushUnique(line.slice(prefixIdx + prefix.length))
        break
      }
    }
  }
  return urls
}

export async function forwardAntigravityCallbackUrl(
  rawCallbackUrl: string,
  pending: { redirectUri: string; state: string },
): Promise<void> {
  const trimmed = rawCallbackUrl.trim()
  if (!trimmed || trimmed.length > 4096) {
    throw new Error('Paste the complete localhost callback URL from the browser address bar')
  }
  let callbackUrl: URL
  let expectedRedirect: URL
  try {
    callbackUrl = new URL(trimmed)
    expectedRedirect = new URL(pending.redirectUri)
  } catch {
    throw new Error('Invalid localhost callback URL')
  }
  if (
    callbackUrl.origin !== expectedRedirect.origin ||
    callbackUrl.pathname !== expectedRedirect.pathname ||
    callbackUrl.username !== '' ||
    callbackUrl.password !== ''
  ) {
    throw new Error(
      'Callback URL does not match the active Antigravity login attempt. Use the URL from the current browser tab.',
    )
  }
  const state = callbackUrl.searchParams.get('state') ?? ''
  const code = callbackUrl.searchParams.get('code')?.trim() ?? ''
  const oauthError = callbackUrl.searchParams.get('error')?.trim() ?? ''
  if (state !== pending.state || (!code && !oauthError)) {
    throw new Error('Callback URL is missing the expected state or authorization code')
  }

  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        protocol: callbackUrl.protocol,
        hostname: callbackUrl.hostname,
        port: callbackUrl.port,
        path: `${callbackUrl.pathname}${callbackUrl.search}`,
        method: 'GET',
        agent: false,
        headers: { Connection: 'close' },
      },
      (res) => {
        res.resume()
        res.once('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve()
          } else {
            reject(
              new Error(`Antigravity rejected the OAuth callback (HTTP ${res.statusCode ?? 0})`),
            )
          }
        })
      },
    )
    req.setTimeout(5000, () => {
      req.destroy(new Error('Timed out delivering the OAuth callback to Antigravity'))
    })
    req.once('error', (err) => {
      reject(new Error(`Failed to deliver OAuth callback to Antigravity: ${err.message}`))
    })
    req.end()
  })
}
