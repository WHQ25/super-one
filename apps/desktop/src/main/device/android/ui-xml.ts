/**
 * A scanner for the one XML dialect `uiautomator dump` emits.
 *
 * Deliberately hand-written rather than a dependency or a regex.
 *
 * Not a dependency, because the only XML in this app arrives here, and a package that
 * has to be declared, bundled and kept inside the asar is a lot of moving parts for
 * ~90 lines of scanning.
 *
 * Not a regex, and this is the part that matters. `text` and `content-desc` carry
 * whatever the app put on screen, so an attribute value can legitimately contain `>`
 * and even `/>` — a button reading "50/> off" is unusual but not malformed. Any
 * pattern of the `<node[^>]*>` family truncates on it and produces a silently wrong
 * tree. Scanning character by character and only ever closing a quote with a quote
 * makes that unrepresentable.
 *
 * What it does NOT handle is everything this dialect never produces: namespaces,
 * CDATA, comments, DTDs, and mixed text content. Those are absent by construction, not
 * by oversight — uiautomator emits a declaration and then nested `<node>` elements
 * with double-quoted attributes, and nothing else.
 */

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

/**
 * Resolve XML entities.
 *
 * Needed for real content, not for edge cases: any UI label containing `&` arrives as
 * `&amp;`, and "Terms &amp; Conditions" on a button is a very ordinary thing to have
 * to tap.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return ENTITIES[body] ?? match
  })
}

const NAME_CHAR = /[A-Za-z0-9_:.-]/

/**
 * Parse the document and return its root element.
 *
 * Null when there is no element at all, which is what a truncated or empty dump looks
 * like. Malformed input past that point stops the scan rather than throwing: a partial
 * tree is more useful to the caller than an exception, and the caller can see for
 * itself that the root has no children.
 */
export function parseXml(source: string): XmlElement | null {
  let index = 0
  const stack: XmlElement[] = []
  let root: XmlElement | null = null

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index]!)) index += 1
  }

  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open < 0) break
    index = open + 1

    // `<?xml ... ?>` and any `<!-- -->` / `<!DOCTYPE>`: skipped whole.
    if (source[index] === '?' || source[index] === '!') {
      const close = source.indexOf('>', index)
      if (close < 0) break
      index = close + 1
      continue
    }

    // `</node>` — close the current element.
    if (source[index] === '/') {
      const close = source.indexOf('>', index)
      if (close < 0) break
      index = close + 1
      stack.pop()
      continue
    }

    const nameStart = index
    while (index < source.length && NAME_CHAR.test(source[index]!)) index += 1
    const name = source.slice(nameStart, index)
    if (!name) continue

    const attributes: Record<string, string> = {}
    let selfClosing = false
    for (;;) {
      skipWhitespace()
      if (index >= source.length) break
      if (source[index] === '/') {
        selfClosing = true
        index += 1
        continue
      }
      if (source[index] === '>') {
        index += 1
        break
      }
      const keyStart = index
      while (index < source.length && NAME_CHAR.test(source[index]!)) index += 1
      const key = source.slice(keyStart, index)
      if (!key) {
        // Something we do not understand. Step over it rather than spinning.
        index += 1
        continue
      }
      skipWhitespace()
      if (source[index] !== '=') {
        attributes[key] = ''
        continue
      }
      index += 1
      skipWhitespace()
      const quote = source[index]
      if (quote !== '"' && quote !== '\'') {
        attributes[key] = ''
        continue
      }
      index += 1
      const valueStart = index
      // The load-bearing line: only a matching quote ends a value, so `>` and `/>`
      // inside one are just characters.
      const end = source.indexOf(quote, index)
      if (end < 0) {
        index = source.length
        break
      }
      attributes[key] = decodeXmlEntities(source.slice(valueStart, end))
      index = end + 1
    }

    const element: XmlElement = { name, attributes, children: [] }
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else if (!root) root = element
    if (!selfClosing) stack.push(element)
  }

  return root
}
