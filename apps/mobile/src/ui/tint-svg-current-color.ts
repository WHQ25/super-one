/**
 * `SvgXml` does not reliably apply `color` to `currentColor` on the first
 * native layout — OpenAI's mark is `currentColor` (Claude's is a hardcoded
 * orange), so switching to Codex painted a black glyph that stayed invisible
 * on dark chrome until a later pass. Bake the theme colour into the XML.
 */
export function tintSvgCurrentColor(xml: string, color: string): string {
  return xml.replace(/currentColor/gi, color)
}
