/**
 * Human-readable labels for WebMCP page tools. Shared because the desktop chat row and the
 * mobile tool summary (computed main-side in remote-control-service) must name the same call
 * the same way — a phone showing `add_to_cart` next to a desktop showing `Add to Cart` reads
 * like two different tools.
 */

/**
 * WebMCP puts no rule on a page tool's name — `sanitizeTool` accepts any non-empty string up to
 * 128 chars — but the ecosystem follows the MCP convention of verb-first snake_case
 * (`request_switch_to_editor`). Pages also ship kebab (`add-todo`), camel (`addTodo`) and dotted
 * namespaces, so the splitter takes all four and anything it cannot read passes through unchanged:
 * a wrong-looking identifier beats an empty label.
 */
const NAME_SEPARATORS = /[\s_\-./:]+/

/** Lowercase inside a title, capitalized at either end. */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of',
  'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'up', 'via', 'vs', 'with',
])

/** Tokens the page wrote lowercase that a human still reads as an acronym. */
const ACRONYMS = new Set([
  'ai', 'api', 'css', 'csv', 'dom', 'html', 'http', 'https', 'id', 'json', 'jwt', 'mcp',
  'ok', 'pdf', 'qr', 'rss', 'seo', 'sql', 'svg', 'ui', 'uri', 'url', 'ux', 'xml', 'yaml',
])

/** A page may name a tool up to 128 chars; past this the label crowds out the row's summary. */
const MAX_DISPLAY_CHARS = 48

/** `getHTMLDoc` → `get HTML Doc`; leaves already-separated names alone. */
function splitCamel(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
}

function titleWord(word: string, isEdge: boolean): string {
  if (/^[A-Z0-9]{2,}$/.test(word)) return word
  const lower = word.toLowerCase()
  if (ACRONYMS.has(lower)) return lower.toUpperCase()
  if (lower.endsWith('s') && ACRONYMS.has(lower.slice(0, -1))) return `${lower.slice(0, -1).toUpperCase()}s`
  if (!isEdge && MINOR_WORDS.has(lower)) return lower
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** `request_switch_to_editor` → `Request Switch to Editor`. */
export function humanizePageToolName(name: string, maxChars = MAX_DISPLAY_CHARS): string {
  const raw = name.trim()
  if (!raw) return ''
  const words = raw.split(NAME_SEPARATORS).flatMap(splitCamel).filter(Boolean)
  if (words.length === 0) return raw
  const titled = words
    .map((word, i) => titleWord(word, i === 0 || i === words.length - 1))
    .join(' ')
  return titled.length > maxChars ? `${titled.slice(0, maxChars)}…` : titled
}
