/** Non-interactive ACP auth ids the node can run before session/new. */

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

export function pickNonInteractiveAcpAuthMethod(
  authMethods: Array<{ id?: string }>,
  defaultAuthMethodId?: string | null,
): string | null {
  const ids = authMethods
    .map((method) => (typeof method.id === 'string' ? method.id.trim() : ''))
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
