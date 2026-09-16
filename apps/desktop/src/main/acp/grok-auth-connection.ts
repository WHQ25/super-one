import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { homedir } from 'node:os'
import { resolveDesktopGrokLaunch } from '../harness/grok-launch'
import { spawnAcpProcess } from './acp-process'
import { xaiExtWireMethod } from './acp-xai-extensions'
import { resolveAcpClientVersion } from './acp-client-info'

export interface GrokAuthConnection {
  initialize(): Promise<{ authMethods?: Array<{ id?: string }> }>
  request(method: string, params: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

/** An auth-only process: never creates a chat session or attaches tools. */
export async function openGrokAuthConnection(): Promise<GrokAuthConnection | null> {
  const launch = resolveDesktopGrokLaunch()
  if (!launch) return null
  const process = spawnAcpProcess({
    agentId: 'grok-build', ...launch,
    cwd: homedir(), env: {},
  })
  const connection = client({ name: 'superone' }).connect(process.stream)
  return {
    initialize: () => connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'superone', version: resolveAcpClientVersion() },
      clientCapabilities: {},
    }),
    request: (method, params) => connection.agent.request(
      method === 'authenticate' ? methods.agent.authenticate : xaiExtWireMethod(method),
      params as never,
    ),
    close: async () => {
      try { connection.close() } finally { await process.kill() }
    },
  }
}
