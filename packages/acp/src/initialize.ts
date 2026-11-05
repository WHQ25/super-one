import { methods, PROTOCOL_VERSION, type ClientConnection } from '@agentclientprotocol/sdk'
import { pickNonInteractiveAcpAuthMethod } from './auth-method'
import { resolveNodeAcpClientVersion } from './client-version'

/** Same handshake for real turns and prompt-free model discovery. */
export async function initializeAcpAgent(connection: ClientConnection, grok: boolean, opts: {
  clientName?: string
  clientVersion?: string
}) {
  const initResult = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: {
      name: opts.clientName ?? 'superone-node',
      version: opts.clientVersion?.trim() || resolveNodeAcpClientVersion(),
    },
    clientCapabilities: grok
      ? { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
      : {},
    _meta: {
      askUserQuestion: true,
      exitPlanMode: true,
      clientIdentifier: 'superone',
    },
  }) as {
    authMethods?: Array<{ id?: string }>
    _meta?: Record<string, unknown> | null
  }

  if (grok) {
    const authMethods = Array.isArray(initResult.authMethods) ? initResult.authMethods : []
    const defaultAuthId = typeof initResult._meta?.defaultAuthMethodId === 'string'
      ? initResult._meta.defaultAuthMethodId
      : null
    const methodId = pickNonInteractiveAcpAuthMethod(authMethods, defaultAuthId)
    if (methodId) {
      await connection.agent.request(methods.agent.authenticate, { methodId })
    }
  }

  return initResult
}
