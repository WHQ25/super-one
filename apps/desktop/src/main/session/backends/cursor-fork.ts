import { app } from 'electron'
import { Agent } from '@cursor/sdk'
import {
  buildCloudOptions,
  mapPermissionToCursorLocal,
  readCursorConfig,
  resolveCursorApiKey,
} from '../../cursor/cursor-auth'
import { buildCursorMcpServers } from '../../cursor/cursor-mcp'
import { getCursorAgentStore } from '../../cursor/cursor-store'
import type { ForkContext, ForkSource } from '../types'

/**
 * Best-effort Cursor fork (PR13):
 * SDK has no transcript-fork API. We create a **new** agent with the same
 * cwd/model/settings and return its agentId. SuperOne already copies the
 * chat transcript into the new session; the Cursor agent starts a fresh
 * provider-side conversation (weak clone).
 */
export async function forkCursorTranscript(
  source: ForkSource,
  targetCwd: string,
  _ctx: ForkContext,
): Promise<string> {
  const config = readCursorConfig(source.providerConfig)
  const apiKey = resolveCursorApiKey(source.providerConfig)
  if (!apiKey) {
    throw new Error('Cursor API key required to fork (new agent create).')
  }

  const isCloud = config.runtime === 'cloud' || source.providerSessionId.startsWith('bc-')
  const modelId = config.model
  const perm = mapPermissionToCursorLocal('default')
  const mcpServers = isCloud ? {} : buildCursorMcpServers(targetCwd, `fork-${Date.now()}`)

  if (isCloud) {
    const agent = await Agent.create({
      apiKey,
      ...(modelId ? { model: { id: modelId } } : {}),
      mode: perm.mode,
      mcpServers,
      name: 'Forked SuperOne session',
      cloud: buildCloudOptions(config),
    })
    const id = agent.agentId
    agent.close()
    return id
  }

  if (!modelId) {
    throw new Error('Cursor model is required on provider config to fork a local agent.')
  }

  const agent = await Agent.create({
    apiKey,
    model: { id: modelId },
    mode: perm.mode,
    mcpServers,
    name: 'Forked SuperOne session',
    local: {
      cwd: targetCwd,
      store: getCursorAgentStore(app.getPath('userData'), targetCwd),
      settingSources: config.settingSources ?? ['project'],
      sandboxOptions: { enabled: config.sandboxEnabled ?? perm.sandboxEnabled },
      autoReview: config.autoReview ?? perm.autoReview,
      enableAgentRetries: config.enableAgentRetries ?? true,
    },
  })
  const id = agent.agentId
  agent.close()
  return id
}
