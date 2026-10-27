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

/** Absolute filesystem path or a URL scheme. Those destinations are already resolvable. */
function isUntouchedDestination(destination: string): boolean {
  return destination.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(destination)
    || /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(destination)
}

/**
 * `<...>` is one destination, and it may contain spaces. The link regex stops
 * at whitespace, so the closing `>` can land in `rest` rather than `src`.
 * Returns null when this is not an angle-bracket destination.
 */
function angleDestination(src: string, rest: string): { inner: string; suffix: string } | null {
  if (!src.startsWith('<')) return null
  const combined = src + rest
  const close = combined.indexOf('>')
  if (close < 1) return null
  return { inner: combined.slice(1, close), suffix: combined.slice(close + 1) }
}

export function resolveMarkdownFileLinks(text: string, projectPath: string): string {
  if (!projectPath) return text
  return text.replace(MD_FILE_LINK_RE, (match, label: string, src: string, rest: string) => {
    const angled = angleDestination(src, rest)
    const destination = angled?.inner ?? src
    const suffix = angled ? angled.suffix : rest
    // Unwrap `<...>` before the absolute check, or a wrapped absolute path
    // is prefixed with the project root and keeps its brackets.
    if (isUntouchedDestination(destination)) return match
    const cleanSrc = destination.replace(/^\.\//, '')
    if (!cleanSrc) return match
    const absolute = `${projectPath}/${cleanSrc}`
    const rendered = angled ? `<${absolute}>` : absolute
    return `[${label}](${rendered}${suffix})`
  })
}
