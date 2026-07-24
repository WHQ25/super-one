import { OpenCodeClient, startOpenCodeServer } from '../../opencode/opencode-client'
import { readOpenCodeConfig } from '../../opencode/opencode-event-map'
import type { ForkContext, ForkSource } from '../types'

function resolveOpenCodeForkAnchor(ctx: ForkContext): string | undefined {
  if (!ctx.forkFromMessageId) return undefined
  const message = ctx.messages.find((candidate) => candidate.id === ctx.forkFromMessageId)
  if (!message) throw new Error('Selected OpenCode fork message was not found')
  const anchor = message.role === 'user' ? message.checkpointId : message.metadata?.forkAnchorId
  if (!anchor) throw new Error('Selected OpenCode message has no provider fork anchor')
  return anchor
}

export async function forkOpenCodeSession(
  source: ForkSource,
  targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const sourceCwd = source.cwd ?? source.projectPath
  const config = readOpenCodeConfig(source.providerConfig)
  const server = await startOpenCodeServer({
    binaryPath: config.binaryPath,
    cwd: sourceCwd,
    env: config.env,
    serverUrl: config.serverUrl,
    timeoutMs: config.startupTimeoutMs,
  })
  try {
    const client = new OpenCodeClient({
      baseUrl: server.url,
      directory: sourceCwd,
      password: config.serverPassword,
    })
    const forked = await client.forkSession(source.providerSessionId, resolveOpenCodeForkAnchor(ctx))
    if (forked.directory !== targetCwd) {
      try {
        await client.moveSession(forked.id, targetCwd)
      } catch (error) {
        await client.deleteSession(forked.id).catch(() => undefined)
        throw error
      }
    }
    return forked.id
  } finally {
    await server.close()
  }
}
