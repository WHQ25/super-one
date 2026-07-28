import { getNodeRuntime } from '../agent/resolve-cli'
import {
  deriveSuperoneMcpSessionToken,
  SUPERONE_MCP_SESSION_HEADER,
} from './superone-mcp-auth'
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
  httpUrl: string
  token: string
  bridgeScriptPath: string
}

export interface SuperoneMcpStdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface SuperoneMcpHttpConfig {
  url: string
  headers: Record<string, string>
}

export interface CodexSuperoneMcpConfig {
  url: string
  http_headers: Record<string, string>
  startup_timeout_sec: number
}

let bridgeRuntime: SuperoneMcpBridgeRuntime | null = null

export function setSuperoneMcpBridgeRuntime(runtime: SuperoneMcpBridgeRuntime | null): void {
  bridgeRuntime = runtime
}

export function getSuperoneMcpStdioConfig(sessionId: string): SuperoneMcpStdioConfig | null {
  if (!bridgeRuntime) return null
  const sessionToken = deriveSuperoneMcpSessionToken(bridgeRuntime.token, sessionId)
  const nodeRuntime = getNodeRuntime('mcp-bridge')
  const command = nodeRuntime.executable ?? process.execPath
  const env: Record<string, string> = {
    ...nodeRuntime.env,
    [SUPERONE_MCP_IPC_ENDPOINT_ENV]: bridgeRuntime.endpoint,
    [SUPERONE_MCP_IPC_TOKEN_ENV]: sessionToken,
    [SUPERONE_MCP_SESSION_ID_ENV]: sessionId,
  }
  if (!nodeRuntime.executable && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return { command, args: [bridgeRuntime.bridgeScriptPath], env }
}

export function getSuperoneMcpHttpConfig(sessionId: string): SuperoneMcpHttpConfig | null {
  if (!bridgeRuntime) return null
  const sessionToken = deriveSuperoneMcpSessionToken(bridgeRuntime.token, sessionId)
  return {
    url: bridgeRuntime.httpUrl,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      [SUPERONE_MCP_SESSION_HEADER]: sessionId,
    },
  }
}

export function getCodexSuperoneMcpConfig(sessionId: string): CodexSuperoneMcpConfig | null {
  const base = getSuperoneMcpHttpConfig(sessionId)
  if (!base) return null
  return {
    url: base.url,
    http_headers: base.headers,
    startup_timeout_sec: SUPERONE_MCP_STARTUP_TIMEOUT_SEC,
  }
}
