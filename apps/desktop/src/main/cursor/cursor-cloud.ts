import {
  Agent,
  Cursor,
  type AgentMessage,
  type ListResult,
  type Run,
  type SDKAgentInfo,
  type SDKArtifact,
} from '@cursor/sdk'
import { app } from 'electron'
import { resolveCursorApiKey } from './cursor-auth'
import { getCursorAgentStore } from './cursor-store'

export interface CursorCloudListAgentsOptions {
  apiKey?: string
  config?: unknown
  limit?: number
  cursor?: string
  includeArchived?: boolean
  prUrl?: string
}

export async function listCursorCloudAgents(
  options: CursorCloudListAgentsOptions,
): Promise<ListResult<SDKAgentInfo>> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required for cloud agent list')
  return Agent.list({
    runtime: 'cloud',
    apiKey,
    limit: options.limit,
    cursor: options.cursor,
    includeArchived: options.includeArchived,
    prUrl: options.prUrl,
  })
}

export async function listCursorLocalAgents(options: {
  cwd: string
  limit?: number
  cursor?: string
  store?: import('@cursor/sdk').LocalAgentStore
}): Promise<ListResult<SDKAgentInfo>> {
  const store = options.store ?? getCursorAgentStore(app.getPath('userData'), options.cwd)
  return Agent.list({
    runtime: 'local',
    cwd: options.cwd,
    limit: options.limit,
    cursor: options.cursor,
    store,
  })
}

export async function getCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown; cwd?: string },
): Promise<SDKAgentInfo> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  const isCloud = agentId.startsWith('bc-')
  if (isCloud && !apiKey) throw new Error('Cursor API key required')
  return Agent.get(agentId, {
    ...(apiKey ? { apiKey } : {}),
    ...(options.cwd
      ? {
          cwd: options.cwd,
          store: getCursorAgentStore(app.getPath('userData'), options.cwd),
        }
      : {}),
  })
}

export async function listCursorAgentMessages(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    cwd?: string
    limit?: number
    offset?: number
  },
): Promise<AgentMessage[]> {
  // SDK messages.list is local-store oriented in 1.0.24
  if (agentId.startsWith('bc-')) {
    throw new Error('Agent.messages.list is local-only in Cursor SDK 1.0.24')
  }
  const cwd = options.cwd ?? process.cwd()
  return Agent.messages.list(agentId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(app.getPath('userData'), cwd),
    limit: options.limit,
    offset: options.offset,
  })
}

export async function getCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    cwd?: string
    runtime?: 'local' | 'cloud'
  },
): Promise<Run> {
  const runtime = options.runtime
    ?? (options.agentId?.startsWith('bc-') || runId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
    if (!apiKey) throw new Error('Cursor API key required for cloud run')
    if (!options.agentId) throw new Error('agentId required for cloud getRun')
    return Agent.getRun(runId, { runtime: 'cloud', agentId: options.agentId, apiKey })
  }
  const cwd = options.cwd ?? process.cwd()
  return Agent.getRun(runId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(app.getPath('userData'), cwd),
  })
}

export async function cancelCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    cwd?: string
    runtime?: 'local' | 'cloud'
  },
): Promise<void> {
  const runtime = options.runtime
    ?? (options.agentId?.startsWith('bc-') || runId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
    if (!apiKey) throw new Error('Cursor API key required for cloud cancelRun')
    if (!options.agentId) throw new Error('agentId required for cloud cancelRun')
    await Agent.cancelRun(runId, { runtime: 'cloud', agentId: options.agentId, apiKey })
    return
  }
  const cwd = options.cwd ?? process.cwd()
  await Agent.cancelRun(runId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(app.getPath('userData'), cwd),
  })
}

export async function listCursorRuns(
  agentId: string,
  options: { apiKey?: string; config?: unknown; runtime?: 'local' | 'cloud'; cwd?: string; limit?: number; cursor?: string },
): Promise<ListResult<Run>> {
  const runtime = options.runtime ?? (agentId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
    if (!apiKey) throw new Error('Cursor API key required for cloud runs')
    return Agent.listRuns(agentId, { runtime: 'cloud', apiKey, limit: options.limit, cursor: options.cursor })
  }
  const cwd = options.cwd ?? process.cwd()
  return Agent.listRuns(agentId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(app.getPath('userData'), cwd),
    limit: options.limit,
    cursor: options.cursor,
  })
}

export async function archiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown },
): Promise<void> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required')
  if (!agentId.startsWith('bc-')) {
    throw new Error('Agent.archive is cloud-only (bc-* ids). Local delete is not supported via archive.')
  }
  await Agent.archive(agentId, { apiKey })
}

export async function unarchiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown },
): Promise<void> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required')
  await Agent.unarchive(agentId, { apiKey })
}

export async function deleteCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown },
): Promise<void> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required')
  if (!agentId.startsWith('bc-')) {
    throw new Error('Agent.delete is cloud-only for SDK 1.0.24. Local agents use store cleanup.')
  }
  await Agent.delete(agentId, { apiKey })
}

export async function listCursorRepositories(options: {
  apiKey?: string
  config?: unknown
}): Promise<Array<{ url: string }>> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required')
  const repos = await Cursor.repositories.list({ apiKey })
  return repos.map((r) => ({ url: r.url }))
}

/** Artifacts require a live SDKAgent handle — open via resume. */
export async function withResumedAgentArtifacts(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    cwd?: string
    model?: string
  },
  fn: (agent: {
    listArtifacts: () => Promise<SDKArtifact[]>
    downloadArtifact: (path: string) => Promise<Buffer>
  }) => Promise<unknown>,
): Promise<unknown> {
  const apiKey = options.apiKey ?? resolveCursorApiKey(options.config)
  if (!apiKey) throw new Error('Cursor API key required')
  const isCloud = agentId.startsWith('bc-')
  const agent = await Agent.resume(agentId, {
    apiKey,
    ...(options.model ? { model: { id: options.model } } : {}),
    ...(isCloud
      ? { cloud: { env: { type: 'cloud' as const } } }
      : { local: { cwd: options.cwd ?? process.cwd() } }),
  })
  try {
    return await fn(agent)
  } finally {
    agent.close()
  }
}

export async function listCursorArtifacts(
  agentId: string,
  options: { apiKey?: string; config?: unknown; cwd?: string; model?: string },
): Promise<SDKArtifact[]> {
  return withResumedAgentArtifacts(agentId, options, (agent) => agent.listArtifacts()) as Promise<SDKArtifact[]>
}

export async function downloadCursorArtifact(
  agentId: string,
  path: string,
  options: { apiKey?: string; config?: unknown; cwd?: string; model?: string },
): Promise<Buffer> {
  return withResumedAgentArtifacts(agentId, options, (agent) => agent.downloadArtifact(path)) as Promise<Buffer>
}
