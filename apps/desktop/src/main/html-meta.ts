// The markup escapes plus the typographic names titles and descriptions use.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', bull: '•', hellip: '…',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? entity
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

/** The document's `<head>`, or as much as was fetched when it never closes. */
function headOf(html: string): string {
  const end = html.search(/<\/head>|<body\b/i)
  return end < 0 ? html : html.slice(0, end)
}

/**
 * The head's `<meta>` values by `property` or `name` (lowercased), first one
 * wins, entities decoded and whitespace collapsed.
 */
export function readHtmlMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>()
  for (const tag of headOf(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>()
    for (const [, name, , double, single, bare] of tag.matchAll(/([^\s=/<>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(name!.toLowerCase(), double ?? single ?? bare ?? '')
    }
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase()
    const content = attrs.get('content')
    if (!key || content == null || meta.has(key)) continue
    const value = decodeHtmlEntities(content).replace(/\s+/g, ' ').trim()
    if (value) meta.set(key, value)
  }
  return meta
}

export function readHtmlTitle(html: string): string | null {
  const title = headOf(html).match(/<title[^>]*>([^<]*)/i)?.[1]
  const value = title ? decodeHtmlEntities(title).replace(/\s+/g, ' ').trim() : ''
  return value || null
}
