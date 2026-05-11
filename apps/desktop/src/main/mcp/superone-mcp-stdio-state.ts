import { getNodeRuntime } from '../agent/resolve-cli'
import {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
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

export interface CodexSuperoneMcpConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

let bridgeRuntime: SuperoneMcpBridgeRuntime | null = null

export function setSuperoneMcpBridgeRuntime(runtime: SuperoneMcpBridgeRuntime | null): void {
  bridgeRuntime = runtime
}

export function getCodexSuperoneMcpConfig(sessionId: string): CodexSuperoneMcpConfig | null {
  if (!bridgeRuntime) return null
  const nodeRuntime = getNodeRuntime()
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
  return {
    command,
    args: [bridgeRuntime.bridgeScriptPath],
    env,
  }
}
