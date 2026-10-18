/** Catalog identity used by both plugin/read and plugin/install. */
export interface CodexPluginTarget {
  name: string
  marketplace: string
  marketplacePath: string | null
  remotePluginId?: string
}

export function buildCodexPluginRequestParams(plugin: CodexPluginTarget): Record<string, string> {
  if (plugin.marketplacePath) {
    return { marketplacePath: plugin.marketplacePath, pluginName: plugin.name }
  }
  if (!plugin.remotePluginId) throw new Error(`Missing remote ID for Codex plugin: ${plugin.name}`)
  return { remoteMarketplaceName: plugin.marketplace, pluginName: plugin.remotePluginId }
}
