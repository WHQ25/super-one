import {
  Agent,
  Cursor,
  type AgentMessage,
  type AgentUsage,
  type ListResult,
  type Run,
  type SDKAgentInfo,
  type SDKArtifact,
} from '@cursor/sdk'
import { resolveCursorApiKeyPlain } from './cursor-config'
import { getCursorAgentStore } from './cursor-store'

type ResolveApiKey = (config: unknown) => string | undefined

function resolveKey(
  options: { apiKey?: string; config?: unknown; resolveApiKey?: ResolveApiKey },
): string | undefined {
  if (options.apiKey) return options.apiKey
  const resolve = options.resolveApiKey ?? resolveCursorApiKeyPlain
  return resolve(options.config)
}

function requireUserDataRoot(userDataRoot: string | undefined, cwd: string): string {
  if (userDataRoot?.trim()) return userDataRoot.trim()
  throw new Error(
    `Cursor local agent store requires userDataRoot (cwd=${cwd}). Pass userDataRoot from the host.`,
  )
}

export interface CursorCloudListAgentsOptions {
  apiKey?: string
  config?: unknown
  resolveApiKey?: ResolveApiKey
  limit?: number
  cursor?: string
  includeArchived?: boolean
  prUrl?: string
}

/** List cloud Cursor agents for the authenticated user. */
export async function listCursorCloudAgents(
  options: CursorCloudListAgentsOptions,
): Promise<ListResult<SDKAgentInfo>> {
  const apiKey = resolveKey(options)
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

/** List local Cursor agents for a workspace. */
export async function listCursorLocalAgents(options: {
  cwd: string
  userDataRoot: string
  limit?: number
  cursor?: string
  store?: import('@cursor/sdk').LocalAgentStore
}): Promise<ListResult<SDKAgentInfo>> {
  const store = options.store
    ?? getCursorAgentStore(requireUserDataRoot(options.userDataRoot, options.cwd), options.cwd)
  return Agent.list({
    runtime: 'local',
    cwd: options.cwd,
    limit: options.limit,
    cursor: options.cursor,
    store,
  })
}

/** Fetch a Cursor agent by id (cloud bc-* or local). */
export async function getCursorAgent(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    userDataRoot?: string
  },
): Promise<SDKAgentInfo> {
  const apiKey = resolveKey(options)
  const isCloud = agentId.startsWith('bc-')
  if (isCloud && !apiKey) throw new Error('Cursor API key required')
  return Agent.get(agentId, {
    ...(apiKey ? { apiKey } : {}),
    ...(options.cwd
      ? {
          cwd: options.cwd,
          store: getCursorAgentStore(
            requireUserDataRoot(options.userDataRoot, options.cwd),
            options.cwd,
          ),
        }
      : {}),
  })
}

/** List local agent messages (SDK 1.0.24 is local-store oriented). */
export async function listCursorAgentMessages(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    userDataRoot: string
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
    store: getCursorAgentStore(requireUserDataRoot(options.userDataRoot, cwd), cwd),
    limit: options.limit,
    offset: options.offset,
  })
}

/** Fetch a Cursor run by id. */
export async function getCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    userDataRoot?: string
    runtime?: 'local' | 'cloud'
  },
): Promise<Run> {
  const runtime = options.runtime
    ?? (options.agentId?.startsWith('bc-') || runId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = resolveKey(options)
    if (!apiKey) throw new Error('Cursor API key required for cloud run')
    if (!options.agentId) throw new Error('agentId required for cloud getRun')
    return Agent.getRun(runId, { runtime: 'cloud', agentId: options.agentId, apiKey })
  }
  const cwd = options.cwd ?? process.cwd()
  return Agent.getRun(runId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(requireUserDataRoot(options.userDataRoot, cwd), cwd),
  })
}

/** Cancel a Cursor run. */
export async function cancelCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    userDataRoot?: string
    runtime?: 'local' | 'cloud'
  },
): Promise<void> {
  const runtime = options.runtime
    ?? (options.agentId?.startsWith('bc-') || runId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = resolveKey(options)
    if (!apiKey) throw new Error('Cursor API key required for cloud cancelRun')
    if (!options.agentId) throw new Error('agentId required for cloud cancelRun')
    await Agent.cancelRun(runId, { runtime: 'cloud', agentId: options.agentId, apiKey })
    return
  }
  const cwd = options.cwd ?? process.cwd()
  await Agent.cancelRun(runId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(requireUserDataRoot(options.userDataRoot, cwd), cwd),
  })
}

/** List runs for a Cursor agent. */
export async function listCursorRuns(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    runtime?: 'local' | 'cloud'
    cwd?: string
    userDataRoot?: string
    limit?: number
    cursor?: string
  },
): Promise<ListResult<Run>> {
  const runtime = options.runtime ?? (agentId.startsWith('bc-') ? 'cloud' : 'local')
  if (runtime === 'cloud') {
    const apiKey = resolveKey(options)
    if (!apiKey) throw new Error('Cursor API key required for cloud runs')
    return Agent.listRuns(agentId, { runtime: 'cloud', apiKey, limit: options.limit, cursor: options.cursor })
  }
  const cwd = options.cwd ?? process.cwd()
  return Agent.listRuns(agentId, {
    runtime: 'local',
    cwd,
    store: getCursorAgentStore(requireUserDataRoot(options.userDataRoot, cwd), cwd),
    limit: options.limit,
    cursor: options.cursor,
  })
}

/** Archive a cloud Cursor agent (bc-* only). */
export async function archiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown; resolveApiKey?: ResolveApiKey },
): Promise<void> {
  const apiKey = resolveKey(options)
  if (!apiKey) throw new Error('Cursor API key required')
  if (!agentId.startsWith('bc-')) {
    throw new Error('Agent.archive is cloud-only (bc-* ids). Local delete is not supported via archive.')
  }
  await Agent.archive(agentId, { apiKey })
}

/** Unarchive a cloud Cursor agent. */
export async function unarchiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown; resolveApiKey?: ResolveApiKey },
): Promise<void> {
  const apiKey = resolveKey(options)
  if (!apiKey) throw new Error('Cursor API key required')
  await Agent.unarchive(agentId, { apiKey })
}

/** Delete a cloud Cursor agent (bc-* only for SDK 1.0.24). */
export async function deleteCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown; resolveApiKey?: ResolveApiKey },
): Promise<void> {
  const apiKey = resolveKey(options)
  if (!apiKey) throw new Error('Cursor API key required')
  if (!agentId.startsWith('bc-')) {
    throw new Error('Agent.delete is cloud-only for SDK 1.0.24. Local agents use store cleanup.')
  }
  await Agent.delete(agentId, { apiKey })
}

/** List Git repositories linked to the Cursor account. */
export async function listCursorRepositories(options: {
  apiKey?: string
  config?: unknown
  resolveApiKey?: ResolveApiKey
}): Promise<Array<{ url: string }>> {
  const apiKey = resolveKey(options)
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
    resolveApiKey?: ResolveApiKey
    cwd?: string
    model?: string
  },
  fn: (agent: {
    listArtifacts: () => Promise<SDKArtifact[]>
    downloadArtifact: (path: string) => Promise<Buffer>
  }) => Promise<unknown>,
): Promise<unknown> {
  const apiKey = resolveKey(options)
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

/** List artifacts for a resumed Cursor agent. */
export async function listCursorArtifacts(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    model?: string
  },
): Promise<SDKArtifact[]> {
  return withResumedAgentArtifacts(agentId, options, (agent) => agent.listArtifacts()) as Promise<SDKArtifact[]>
}

/** Download one artifact from a resumed Cursor agent. */
export async function downloadCursorArtifact(
  agentId: string,
  path: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    cwd?: string
    model?: string
  },
): Promise<Buffer> {
  return withResumedAgentArtifacts(agentId, options, (agent) => agent.downloadArtifact(path)) as Promise<Buffer>
}

/**
 * Billed token usage + optional dollar cost for an agent (SDK ≥1.0.25).
 * Cloud: per-run breakdown. Local: per-turn groups keyed by usage UUID.
 */
export async function getCursorAgentUsage(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    resolveApiKey?: ResolveApiKey
    runId?: string
  } = {},
): Promise<AgentUsage> {
  const apiKey = resolveKey(options)
  if (!apiKey) throw new Error('Cursor API key required for Agent.getUsage')
  return Agent.getUsage(agentId, {
    apiKey,
    ...(options.runId ? { runId: options.runId } : {}),
  })
}
