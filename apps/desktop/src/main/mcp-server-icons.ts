import { mcpIconMapFromSources, mcpIconSourcesFrom } from '@superone/shared/mcp-server-icon'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { listLibrary, backupMcpServers } from './mcp-library-service'
import { checkMcpServers, readMcpMetaCache } from './mcp-probe-service'
import { listMcpConfigs } from './mcp-config-service'
import { listCodexMcpConfigs } from './codex-config-service'
import { listDshMcpConfigs } from '@superone/runtime/fs'
import { listInstalledMcpb } from './mcpb/mcpb-installer'

/** Brand-icon map for chat tool rows and the mobile `get_mcp_icons` command. */
export async function collectMcpServerIconMap(): Promise<Record<string, string>> {
  let bundles: Awaited<ReturnType<typeof listInstalledMcpb>> = []
  try {
    bundles = await listInstalledMcpb()
  } catch {
    bundles = []
  }
  return mcpIconMapFromSources(mcpIconSourcesFrom({
    library: listLibrary(),
    bundles,
    meta: readMcpMetaCache(),
  }))
}

async function probeHarnessConfigs(configs: McpServerConfig[]): Promise<void> {
  const enabled = configs.filter((config) => !config.disabled)
  if (enabled.length === 0) return
  const cache = readMcpMetaCache()
  const missing = enabled.filter((config) => !cache[config.name]?.icons?.[0]?.src)
  if (missing.length === 0) return
  const result = await checkMcpServers(missing)
  try {
    backupMcpServers(missing, result.meta)
  } catch {
    /* library backup is best-effort */
  }
}

/**
 * Fill the shared icon cache from Claude, Codex, and dsh MCP configs.
 * Skips servers that already have an icon so chat open does not re-handshake.
 */
export async function probeMcpIconsForAllHarnesses(projectPath = ''): Promise<void> {
  await Promise.allSettled([
    probeHarnessConfigs(listMcpConfigs(projectPath)),
    probeHarnessConfigs(listCodexMcpConfigs(projectPath)),
    probeHarnessConfigs(listDshMcpConfigs(projectPath)),
  ])
}
