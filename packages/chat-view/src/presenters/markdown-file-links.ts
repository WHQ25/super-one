/**
 * Project-relative markdown link destinations, resolved to absolute host paths
 * before the markdown is parsed.
 *
 * This runs at the TEXT level on purpose. `rehype-harden` blocks a destination
 * it cannot classify, and `src/ToolRow.tsx:42` reads as an unknown scheme — so
 * a link left relative is replaced by a "Blocked URL" stub and never reaches
 * the component that would render it as a file chip. Rewriting first means
 * harden only ever sees an absolute path.
 *
 * The media half of this deliberately lives on the desktop side: a WebView has
 * no transport that could fetch a host file, so rewriting an image `src` there
 * would only trade one broken image for another.
 */
const MD_FILE_LINK_RE =
  /(?<!!)\[([^\]]*)\]\((?!https?:\/\/|mailto:|data:|#|local-file:\/\/|remote-media:\/\/)([^)\s]+)([^)]*)\)/g

export function resolveMarkdownFileLinks(text: string, projectPath: string): string {
  if (!projectPath) return text
  return text.replace(MD_FILE_LINK_RE, (match, label: string, src: string, rest: string) => {
    if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) return match
    if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src)) return match
    const cleanSrc = src.replace(/^\.\//, '')
    return `[${label}](${projectPath}/${cleanSrc}${rest})`
  })
}
