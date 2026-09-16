/**
 * ACP / Grok authenticate method picking.
 *
 * Non-interactive ids (cached_token, api_key) can run during session setup.
 * Interactive grok.com / OIDC needs x.ai/auth/get_url + submit_code.
 */

export function isNonInteractiveAcpAuthMethod(id: string | undefined | null): boolean {
  if (!id) return false
  const lower = id.trim().toLowerCase()
  if (!lower) return false
  if (lower === 'cached_token' || lower === 'xai.api_key' || lower === 'api_key') return true
  if (lower.includes('oidc') || lower === 'grok.com' || lower.includes('login')) return false
  return lower.includes('cached')
    || lower.includes('api_key')
    || lower.includes('apikey')
    || lower.includes('token')
}

export function isInteractiveAcpAuthMethod(id: string | undefined | null): boolean {
  if (!id) return false
  const lower = id.trim().toLowerCase()
  return lower === 'grok.com'
    || lower.includes('oidc')
    || lower.includes('login')
}

export function pickNonInteractiveAcpAuthMethod(
  authMethods: Array<{ id?: string }>,
  defaultAuthMethodId?: string | null,
): string | null {
  const ids = authMethods
    .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
    .filter(Boolean)
  if (
    defaultAuthMethodId
    && isNonInteractiveAcpAuthMethod(defaultAuthMethodId)
    && ids.includes(defaultAuthMethodId)
  ) {
    return defaultAuthMethodId
  }
  return ids.find((id) => isNonInteractiveAcpAuthMethod(id)) ?? null
}

export function parseGrokAuthUrl(raw: unknown): {
  authUrl: string
  mode?: string
  externalProvider: boolean
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const authUrl =
    (typeof o.auth_url === 'string' && o.auth_url.trim())
    || (typeof o.authUrl === 'string' && o.authUrl.trim())
    || ''
  if (!authUrl) return null
  const mode =
    typeof o.mode === 'string' && o.mode.trim()
      ? o.mode.trim()
      : undefined
  return {
    authUrl,
    ...(mode ? { mode } : {}),
    externalProvider: o.external_provider === true || o.externalProvider === true,
  }
}
