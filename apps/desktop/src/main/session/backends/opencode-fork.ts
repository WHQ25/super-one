import { readOpenCodeConfig } from '../../opencode/opencode-event-map'
import { withOpenCodeSessionAdmin } from '../../opencode/opencode-runtime'
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
  return withOpenCodeSessionAdmin(readOpenCodeConfig(source.providerConfig), sourceCwd, async (client) => {
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
  })
}
