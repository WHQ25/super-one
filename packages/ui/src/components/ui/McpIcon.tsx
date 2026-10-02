import McpMono from '@lobehub/icons/es/MCP/components/Mono'

/**
 * The Model Context Protocol mark in the current text colour. Deep-imported so
 * the icon set's barrel never lands in a bundle that only needs this glyph.
 */
export function McpIcon({ className }: { className?: string }) {
  return <McpMono className={className} aria-hidden />
}
