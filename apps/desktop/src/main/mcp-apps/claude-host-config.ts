import { listMcpConfigs } from '../mcp-config-service'
import { hostClientConfig, type HostClientConfig } from './host-client'

/**
 * What SuperOne connects to for a server Claude reports. `mcpServerStatus()`
 * gives stdio servers without their `env`, so it comes from the config file
 * Claude read, and only when command and args are exactly the ones Claude
 * runs: that env never reaches another process. Servers whose file config
 * cannot be matched (plugin servers, `${VAR}` expansion) stay unreachable.
 */
export function claudeHostClientConfig(cwd: string, server: string, reported: unknown): HostClientConfig | null {
  const config = hostClientConfig(reported)
  if (config?.type !== 'stdio') return config
  const file = hostClientConfig(listMcpConfigs(cwd).find(candidate => candidate.name === server))
  if (file?.type !== 'stdio' || file.command !== config.command || JSON.stringify(file.args) !== JSON.stringify(config.args)) return null
  return { ...config, env: file.env }
}
