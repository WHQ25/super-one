import { client, methods } from '@agentclientprotocol/sdk'
import { initializeAcpAgent } from './initialize'
import { isGrokAcpLaunch } from './grok-turn-meta'
import { modelsFromSessionResult, extractModelsFromAgentModelsField } from './config-map'
import { spawnAcpProcess, type AcpLaunch } from './process'
import { parseXaiExtParams } from './xai-state'
import type { ModelOption } from '@superone/shared/agent-types'

/** Discover without sending a prompt, attaching MCP, or approving tools. */
export async function probeAcpModels(opts: {
  launch: AcpLaunch
  cwd: string
  clientVersion?: string
  timeoutMs?: number
}): Promise<ModelOption[]> {
  const processHandle = spawnAcpProcess({ ...opts.launch, cwd: opts.cwd })
  let notified: ReturnType<typeof extractModelsFromAgentModelsField> = null
  let builder = client({ name: 'superone-node' })
    .onRequest(methods.client.session.requestPermission, async () => ({ outcome: { outcome: 'cancelled' as const } }))
  for (const method of ['x.ai/models/update', '_x.ai/models/update']) {
    builder = builder.onNotification(method, parseXaiExtParams, async ctx => {
      notified = extractModelsFromAgentModelsField(ctx.params)
    })
  }
  const connection = builder.connect(processHandle.stream)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const discover = async () => {
      await initializeAcpAgent(connection, isGrokAcpLaunch(opts.launch), opts)
      const active = await connection.agent.buildSession({ cwd: opts.cwd, mcpServers: [] }).start()
      try {
        const catalog = modelsFromSessionResult(active.newSessionResponse) ?? notified
        return catalog?.models.map(model => ({ ...model, isDefault: model.id === catalog.selectedModelId })) ?? []
      } finally { active.dispose() }
    }
    return await Promise.race([discover(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ACP model discovery timed out')), opts.timeoutMs ?? 15000)
    })])
  } finally {
    clearTimeout(timer)
    connection.close()
    await processHandle.kill().catch(() => {})
  }
}
