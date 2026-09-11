/** The slice of an element the theme touches, narrow enough for a test to fake. */
export interface ThemedElement {
  style: {
    colorScheme: string
    setProperty(name: string, value: string): void
    removeProperty(name: string): string
  }
  classList: { contains(token: string): boolean; toggle(token: string, force?: boolean): boolean }
}

export interface DocumentTheme {
  hue: number
  scheme: 'light' | 'dark'
}

/**
 * Stamp the current theme onto the document and hand the background back to
 * the stylesheet. The mobile host pre-paints its mount-time background inline
 * on `<html>`/`<body>` (`chatViewPrePaintScript`) so WKWebView never flashes
 * white before this bundle's CSS lands. Inline outranks
 * `html, body { background: var(--background) }`, and `#root` is only one
 * viewport tall, so a later scheme switch would repaint the first screen and
 * leave everything below it on the mount-time colour.
 */
export function applyDocumentTheme(root: ThemedElement, body: ThemedElement | null, theme: DocumentTheme): void {
  root.style.setProperty('--brand-hue', String(theme.hue))
  root.classList.toggle('dark', theme.scheme === 'dark')
  root.style.colorScheme = theme.scheme
  root.style.removeProperty('background')
  body?.style.removeProperty('background')
}

/**
 * The scheme the document already wears when React mounts. The mobile host
 * stamps `.dark` (or clears it) in its pre-paint script, so starting from the
 * class instead of a constant keeps the first React paint on the host's scheme
 * rather than flipping to dark until `setTheme` arrives over the bridge.
 */
export function initialDocumentScheme(root: Pick<ThemedElement, 'classList'>): DocumentTheme['scheme'] {
  return root.classList.contains('dark') ? 'dark' : 'light'
}
