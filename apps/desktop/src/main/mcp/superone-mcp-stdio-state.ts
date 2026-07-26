import { getNodeRuntime } from '../agent/resolve-cli'
import {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
  SUPERONE_MCP_STARTUP_TIMEOUT_SEC,
} from './superone-mcp-stdio-env'

export {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
}

interface SuperoneMcpBridgeRuntime {
  endpoint: string
  token: string
  bridgeScriptPath: string
}

export interface SuperoneMcpStdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface CodexSuperoneMcpConfig extends SuperoneMcpStdioConfig {
  startup_timeout_sec: number
}

let bridgeRuntime: SuperoneMcpBridgeRuntime | null = null

export function setSuperoneMcpBridgeRuntime(runtime: SuperoneMcpBridgeRuntime | null): void {
  bridgeRuntime = runtime
}

export function getSuperoneMcpStdioConfig(sessionId: string): SuperoneMcpStdioConfig | null {
  if (!bridgeRuntime) return null
  const nodeRuntime = getNodeRuntime('mcp-bridge')
  const command = nodeRuntime.executable ?? process.execPath
  const env: Record<string, string> = {
    ...nodeRuntime.env,
    [SUPERONE_MCP_IPC_ENDPOINT_ENV]: bridgeRuntime.endpoint,
    [SUPERONE_MCP_IPC_TOKEN_ENV]: bridgeRuntime.token,
    [SUPERONE_MCP_SESSION_ID_ENV]: sessionId,
  }
  if (!nodeRuntime.executable && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return { command, args: [bridgeRuntime.bridgeScriptPath], env }
}

export function getCodexSuperoneMcpConfig(sessionId: string): CodexSuperoneMcpConfig | null {
  const base = getSuperoneMcpStdioConfig(sessionId)
  if (!base) return null
  return { ...base, startup_timeout_sec: SUPERONE_MCP_STARTUP_TIMEOUT_SEC }
}
