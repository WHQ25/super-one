import { relaySiteRoot, type ServiceEndpoint } from '@superone/shared/platform-registry'

export function identityKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return relaySiteRoot(trimmed) || trimmed
}

export function hasUrlScheme(raw: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(raw.trim())
}

/** After blur: add `https://` only when the value has no scheme yet. */
export function ensureHttpsPrefix(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || hasUrlScheme(trimmed)) return trimmed
  return `https://${trimmed}`
}

export function baseUrlHasHost(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  try {
    const url = new URL(hasUrlScheme(trimmed) ? trimmed : `https://${trimmed}`)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
  } catch {
    return false
  }
}

/**
 * Normalise a stored site root for display / probing. Endpoints no longer carry one.
 *
 * Tolerates a missing value: plans written before the site root moved onto the plan have no
 * `baseUrl` at all, and the settings page has to stay openable long enough for the user to see them.
 */
export function siteRootOf(baseUrl: string | undefined): string {
  if (!baseUrl) return ''
  return relaySiteRoot(baseUrl) || baseUrl
}
