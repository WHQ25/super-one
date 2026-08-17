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

export function siteRootFromEndpoints(endpoints: ServiceEndpoint[]): string {
  const first = endpoints[0]
  return first ? relaySiteRoot(first.baseUrl) || first.baseUrl : ''
}
