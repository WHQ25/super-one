export const ANTIGRAVITY_AUTH_STDOUT_PREFIX =
  'Open the following link to authenticate the ACP server: '
export const ANTIGRAVITY_AUTH_STDERR_PREFIX = 'Please visit the following URL to authorize: '
export const ANTIGRAVITY_AUTH_BROWSER_MARKER = '__SUPERONE_ANTIGRAVITY_AUTH_URL__'

const ANTIGRAVITY_CODE_REDIRECT_URI = 'https://antigravity.google/oauth-callback'
const MAX_AUTH_URL_LENGTH = 16_384

export interface ValidatedAntigravityOAuthUrl {
  authUrl: string
  redirectUri: string
  state: string
  mode: 'code' | 'loopback'
}

export function validateAntigravityOAuthUrl(
  rawUrl: string,
  expectedMode?: 'code' | 'loopback',
): ValidatedAntigravityOAuthUrl {
  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed.length > MAX_AUTH_URL_LENGTH || /\s/.test(trimmed)) {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  if (
    parsed.origin !== 'https://accounts.google.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  const state = parsed.searchParams.get('state')
  const redirectUri = parsed.searchParams.get('redirect_uri')
  const responseType = parsed.searchParams.get('response_type')
  if (
    !state ||
    state.length > 512 ||
    /\s/.test(state) ||
    !redirectUri ||
    responseType !== 'code' ||
    parsed.searchParams.getAll('state').length !== 1 ||
    parsed.searchParams.getAll('redirect_uri').length !== 1 ||
    parsed.searchParams.getAll('response_type').length !== 1
  ) {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }

  const isCodeFlow =
    parsed.pathname === '/o/oauth2/auth' && redirectUri === ANTIGRAVITY_CODE_REDIRECT_URI
  if (isCodeFlow && expectedMode !== 'loopback') {
    return {
      authUrl: trimmed,
      redirectUri,
      state,
      mode: 'code',
    }
  }

  const isLoopbackPath =
    parsed.pathname === '/o/oauth2/v2/auth' || parsed.pathname === '/o/oauth2/auth'
  if (!isLoopbackPath || expectedMode === 'code') {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  let redirect: URL
  try {
    redirect = new URL(redirectUri)
  } catch {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  const isLocalHost = redirect.hostname === '127.0.0.1' || redirect.hostname === 'localhost'
  const port = Number(redirect.port)
  if (
    redirect.protocol !== 'http:' ||
    !isLocalHost ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535
  ) {
    throw new Error('Antigravity returned an invalid Google sign-in URL.')
  }
  return {
    authUrl: trimmed,
    redirectUri,
    state,
    mode: 'loopback',
  }
}

export function extractAntigravityAuthUrlFromStdoutLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('https://accounts.google.com/')) {
    return trimmed
  }
  for (const prefix of [ANTIGRAVITY_AUTH_STDOUT_PREFIX, ANTIGRAVITY_AUTH_STDERR_PREFIX]) {
    if (trimmed.startsWith(prefix)) {
      const candidate = trimmed.slice(prefix.length).trim()
      if (candidate) return candidate
    }
  }
  return null
}

export function extractAntigravityAuthUrlsFromStderrChunk(chunk: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const pushUnique = (raw: string) => {
    const candidate = raw.trim()
    if (!candidate || seen.has(candidate)) return
    seen.add(candidate)
    urls.push(candidate)
  }
  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const markerIdx = line.indexOf(ANTIGRAVITY_AUTH_BROWSER_MARKER)
    if (markerIdx >= 0) {
      pushUnique(line.slice(markerIdx + ANTIGRAVITY_AUTH_BROWSER_MARKER.length))
      continue
    }
    for (const prefix of [ANTIGRAVITY_AUTH_STDERR_PREFIX, ANTIGRAVITY_AUTH_STDOUT_PREFIX]) {
      const idx = line.indexOf(prefix)
      if (idx >= 0) {
        pushUnique(line.slice(idx + prefix.length))
      }
    }
  }
  return urls
}

export function validateAntigravityLoginCodeResponse(
  pending: { redirectUri: string; state: string },
  response: string,
): string | null {
  const value = response.trim()
  if (!value) return null
  if (/^[\w./~-]{1,2048}$/.test(value)) return value
  if (value.length > MAX_AUTH_URL_LENGTH || /\s/.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (
    `${parsed.origin}${parsed.pathname}` !== pending.redirectUri ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.searchParams.getAll('state').length !== 1 ||
    parsed.searchParams.get('state') !== pending.state ||
    parsed.searchParams.getAll('code').length !== 1 ||
    !parsed.searchParams.get('code')
  ) {
    return null
  }
  return value
}

export async function forwardAntigravityCallbackUrl(
  rawCallbackUrl: string,
  pending: { redirectUri: string; state: string },
): Promise<void> {
  const trimmed = rawCallbackUrl.trim()
  if (!trimmed || trimmed.length > MAX_AUTH_URL_LENGTH || /\s/.test(trimmed)) {
    throw new Error('Paste the full callback URL from your browser.')
  }
  let callback: URL
  let expected: URL
  try {
    callback = new URL(trimmed)
    expected = new URL(pending.redirectUri)
  } catch {
    throw new Error('Invalid callback URL.')
  }
  const sameHost =
    callback.hostname === expected.hostname ||
    ((callback.hostname === 'localhost' || callback.hostname === '127.0.0.1') &&
      (expected.hostname === 'localhost' || expected.hostname === '127.0.0.1'))
  if (
    callback.protocol !== 'http:' ||
    !sameHost ||
    callback.port !== expected.port ||
    callback.pathname !== expected.pathname ||
    callback.searchParams.get('state') !== pending.state ||
    !callback.searchParams.get('code')
  ) {
    throw new Error('Callback URL does not match the active sign-in session.')
  }
  const target = new URL(expected.toString())
  target.search = callback.search
  const response = await fetch(target.toString(), { redirect: 'manual' })
  if (!response.ok && response.status >= 400) {
    throw new Error(`Callback handoff failed (HTTP ${response.status}).`)
  }
}
