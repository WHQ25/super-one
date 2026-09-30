import type { McpUiResourceMeta } from '../mcp-apps'

type CspDomains = NonNullable<McpUiResourceMeta['csp']>

/** Normalize each directive independently. Untrusted metadata cannot add CSP syntax. */
export function mcpAppCspDomains(csp: CspDomains = {}): CspDomains {
  const origins = (values: string[] | undefined, connect = false): string[] => {
    if (!Array.isArray(values)) return []
    return [...new Set(values.flatMap(value => {
      if (typeof value !== 'string' || /[\s*'";<>]/.test(value)) return []
      try {
        const url = new URL(value)
        if (url.username || url.password || !['https:', ...(connect ? ['ws:', 'wss:'] : [])].includes(url.protocol)) return []
        return [url.origin]
      } catch { return [] }
    }))]
  }
  return {
    connectDomains: origins(csp.connectDomains, true),
    resourceDomains: origins(csp.resourceDomains),
    frameDomains: origins(csp.frameDomains),
    baseUriDomains: origins(csp.baseUriDomains),
  }
}

export function buildMcpAppCsp(csp?: CspDomains): string {
  const domains = mcpAppCspDomains(csp)
  const sources = (values: string[] | undefined, fallback: string): string => values?.length ? values.join(' ') : fallback
  const resources = sources(domains.resourceDomains, '')
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${resources}`.trim(),
    `style-src 'self' 'unsafe-inline' ${resources}`.trim(),
    `img-src 'self' data: ${resources}`.trim(),
    `media-src 'self' data: ${resources}`.trim(),
    `font-src 'self' ${resources}`.trim(),
    `connect-src ${sources(domains.connectDomains, "'none'")}`,
    `frame-src ${sources(domains.frameDomains, "'none'")}`,
    `base-uri ${sources(domains.baseUriDomains, "'self'")}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ')
}

/** Insert before any script in a mobile srcdoc document. */
export function mcpAppCspMeta(csp?: CspDomains): string {
  const escaped = buildMcpAppCsp(csp).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<meta http-equiv="Content-Security-Policy" content="${escaped}">`
}

export function mcpAppAllowAttribute(granted: McpUiResourceMeta['permissions'] = {}): string {
  return (['camera', 'microphone', 'geolocation', 'clipboardWrite'] as const)
    .filter(key => Object.hasOwn(granted, key))
    .map(key => key === 'clipboardWrite' ? 'clipboard-write' : key).join('; ')
}
