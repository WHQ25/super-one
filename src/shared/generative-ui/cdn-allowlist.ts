const ALLOWED_HOSTS = [
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.jsdelivr.net',
  'unpkg.com',
]

const CDN_VERSIONS: Record<string, { pattern: RegExp; replacement: string }> = {
  'Chart.js': {
    pattern: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/[\d.]+\//g,
    replacement: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/',
  },
  'three.js': {
    pattern: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/[\w.]+\//g,
    replacement: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/',
  },
  'd3': {
    pattern: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/[\d.]+\//g,
    replacement: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/',
  },
  'mermaid': {
    pattern: /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid\/[\d.]+\//g,
    replacement: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.12.0/',
  },
}

function isAllowedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.includes(host)
  } catch {
    return false
  }
}

const EXTERNAL_URL_RE = /(?:<script\b[^>]*\bsrc|<link\b[^>]*\bhref)\s*=\s*["']([^"']+)["']/gi

export function checkCdnViolations(html: string): string[] {
  const violations: string[] = []
  let m: RegExpExecArray | null
  EXTERNAL_URL_RE.lastIndex = 0
  while ((m = EXTERNAL_URL_RE.exec(html))) {
    const url = m[1]
    if (url.startsWith('http') && !isAllowedUrl(url)) {
      violations.push(url)
    }
  }
  return violations
}

function stripBlockedResources(html: string): string {
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi, (match, url) => {
    return isAllowedUrl(url) ? match : ''
  })
  html = html.replace(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/gi, (match, url) => {
    return isAllowedUrl(url) ? match : ''
  })
  return html
}

export function rewriteCdnUrls(html: string): string {
  for (const entry of Object.values(CDN_VERSIONS)) {
    html = html.replace(entry.pattern, entry.replacement)
  }
  html = stripBlockedResources(html)
  return html
}
