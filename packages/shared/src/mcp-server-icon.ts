/**
 * Resolve an MCP server's brand icon for a chat tool row.
 *
 * Sources are searched in array order; a later match of the same kind wins, so
 * callers should append higher-priority sources last (library → mcpb → meta).
 * Lookup is case-insensitive so Grok's `GitHub` and the config key `github`
 * resolve to the same artwork.
 */

export interface McpIconSource {
  name: string
  src: string
}

export function mcpIconSourcesFrom(input: {
  library?: ReadonlyArray<{ name: string; icons?: ReadonlyArray<{ src?: string }> }>
  bundles?: ReadonlyArray<{ meta: { name: string }; iconDataUrl?: string }>
  meta?: Record<string, { name?: string; icons?: ReadonlyArray<{ src?: string }> }>
}): McpIconSource[] {
  const sources: McpIconSource[] = []
  for (const entry of input.library ?? []) {
    const src = entry.icons?.[0]?.src
    if (src) sources.push({ name: entry.name, src })
  }
  for (const bundle of input.bundles ?? []) {
    if (bundle.iconDataUrl) sources.push({ name: bundle.meta.name, src: bundle.iconDataUrl })
  }
  for (const [key, info] of Object.entries(input.meta ?? {})) {
    const src = info.icons?.[0]?.src
    if (src) sources.push({ name: info.name || key, src })
  }
  return sources
}

export function resolveMcpServerIcon(
  serverName: string,
  sources: readonly McpIconSource[],
): string | undefined {
  const needle = serverName.trim().toLowerCase()
  if (!needle) return undefined
  let exact: string | undefined
  let caseInsensitive: string | undefined
  for (const source of sources) {
    if (!source.src) continue
    if (source.name === serverName) exact = source.src
    else if (source.name.toLowerCase() === needle) caseInsensitive = source.src
  }
  return exact ?? caseInsensitive
}

export function mcpIconMapFromSources(sources: readonly McpIconSource[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const source of sources) map[source.name] = source.src
  return map
}

export function resolveMcpServerIconFromMap(
  serverName: string,
  icons: Record<string, string>,
): string | undefined {
  if (icons[serverName]) return icons[serverName]
  const needle = serverName.trim().toLowerCase()
  if (!needle) return undefined
  for (const [name, src] of Object.entries(icons)) {
    if (name.toLowerCase() === needle) return src
  }
  return undefined
}
