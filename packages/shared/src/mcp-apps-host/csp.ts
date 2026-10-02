import type { McpUiResourceMeta } from '../mcp-apps'

type CspDomains = NonNullable<McpUiResourceMeta['csp']>

/** Normalize each directive independently. Untrusted metadata cannot add CSP syntax. */
export function mcpAppCspDomains(csp: CspDomains = {}): CspDomains {
  const origins = (values: string[] | undefined, connect = false): string[] => {
    if (!Array.isArray(values)) return []
    return [...new Set(values.flatMap(value => {
      if (typeof value !== 'string' || /[\s'";<>]/.test(value)) return []
      try {
        const wildcard = value.includes('*')
        // Only a complete leftmost subdomain wildcard, over a multi-label DNS host.
        if (wildcard && !/^(?:https|wss|ws):\/\/\*\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?(?::\d+)?(?:\/[^*]*)?$/i.test(value)) return []
        const url = new URL(wildcard ? value.replace('://*.', '://mcp-wildcard.') : value)
        if (url.username || url.password || !['https:', ...(connect ? ['ws:', 'wss:'] : [])].includes(url.protocol)) return []
        return [wildcard ? url.origin.replace('://mcp-wildcard.', '://*.') : url.origin]
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
    // Eval, WebAssembly and workers add no origin or network reach: connect-src still
    // governs what they fetch, and inline script already runs arbitrary code. Emscripten
    // glue (e.g. a CAD importer) builds functions with `new Function`.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${resources}`.trim(),
    "worker-src 'self' blob: data:",
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

/** Accept only host-granted permissions. Never pass the resource's untrusted declarations. */
export function mcpAppAllowAttribute(granted: McpUiResourceMeta['permissions'] = {}): string {
  return (['camera', 'microphone', 'geolocation', 'clipboardWrite'] as const)
    .filter(key => Object.hasOwn(granted, key))
    .map(key => key === 'clipboardWrite' ? 'clipboard-write' : key).join('; ')
}
