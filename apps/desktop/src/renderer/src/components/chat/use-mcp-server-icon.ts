import { useMemo } from 'react'
import { mcpIconSourcesFrom, resolveMcpServerIcon } from '@superone/shared/mcp-server-icon'
import { useSettingsStore } from '@/stores/settings'

/** Brand icon for an MCP server name (Claude, Codex, dsh, Grok — same cache). */
export function useMcpServerIcon(serverName: string | undefined): string | undefined {
  const mcpMeta = useSettingsStore((state) => state.mcpMeta)
  const mcpMetaCache = useSettingsStore((state) => state.mcpMetaCache) ?? {}
  const mcpLibrary = useSettingsStore((state) => state.mcpLibrary)
  const mcpbInstalled = useSettingsStore((state) => state.mcpbInstalled) ?? []
  return useMemo(() => {
    if (!serverName) return undefined
    return resolveMcpServerIcon(serverName, mcpIconSourcesFrom({
      library: mcpLibrary,
      bundles: mcpbInstalled,
      meta: { ...mcpMetaCache, ...mcpMeta },
    }))
  }, [mcpLibrary, mcpMeta, mcpMetaCache, mcpbInstalled, serverName])
}
