/**
 * Grok `x.ai/rewind` for a node that does not keep the ACP process between turns.
 * Load the stored provider session, run one rewind, then close the process.
 */
import { client, methods } from '@agentclientprotocol/sdk'
import type { ChatMessage, RewindFilesResult } from '@superone/shared/agent-types'
import { initializeAcpAgent } from './initialize'
import { spawnAcpProcess, type AcpLaunch } from './process'

export const XAI_REWIND_POINTS = 'x.ai/rewind/points'
export const XAI_REWIND_EXECUTE = 'x.ai/rewind/execute'

export type GrokRewindMode = 'all' | 'conversation_only' | 'files_only'

function wire(method: string): string {
  return method.startsWith('_') ? method : `_${method}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function strField(record: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const camelValue = record[camel]
  if (typeof camelValue === 'string' && camelValue.trim()) return camelValue.trim()
  const snakeValue = record[snake]
  if (typeof snakeValue === 'string' && snakeValue.trim()) return snakeValue.trim()
  return undefined
}

function numField(record: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const camelValue = record[camel]
  if (typeof camelValue === 'number' && Number.isFinite(camelValue)) return camelValue
  const snakeValue = record[snake]
  if (typeof snakeValue === 'number' && Number.isFinite(snakeValue)) return snakeValue
  return undefined
}

function boolField(record: Record<string, unknown>, camel: string, snake: string): boolean | undefined {
  const camelValue = record[camel]
  if (typeof camelValue === 'boolean') return camelValue
  const snakeValue = record[snake]
  if (typeof snakeValue === 'boolean') return snakeValue
  return undefined
}

function unwrap(raw: unknown): Record<string, unknown> | null {
  const record = asRecord(raw)
  if (!record) return null
  return asRecord(record.result) ?? record
}

export interface GrokRewindPoint {
  promptIndex: number
  hasFileChanges: boolean
  numFileSnapshots: number
}

export function grokPromptIndexForCheckpoint(messages: ChatMessage[], checkpointId: string): number | null {
  const prompts = messages.filter((message) => message.role === 'user' && message.checkpointId)
  const index = prompts.findIndex((message) => message.checkpointId === checkpointId || message.id === checkpointId)
  return index >= 0 ? index : null
}

export function parseGrokRewindPoints(raw: unknown): GrokRewindPoint[] {
  const record = unwrap(raw)
  const list = record?.rewindPoints ?? record?.rewind_points
  if (!Array.isArray(list)) return []
  const points: GrokRewindPoint[] = []
  for (const item of list) {
    const point = asRecord(item)
    if (!point) continue
    const promptIndex = numField(point, 'promptIndex', 'prompt_index')
    if (promptIndex == null || promptIndex < 0) continue
    points.push({
      promptIndex,
      hasFileChanges: boolField(point, 'hasFileChanges', 'has_file_changes') === true,
      numFileSnapshots: Math.max(0, Math.trunc(numField(point, 'numFileSnapshots', 'num_file_snapshots') ?? 0)),
    })
  }
  return points
}

function previewFromPoints(points: GrokRewindPoint[], promptIndex: number): RewindFilesResult {
  const point = points.find((item) => item.promptIndex === promptIndex)
  if (!point) return { canRewind: false, supportsCodeOnly: true, error: `No Grok rewind point at prompt ${promptIndex}` }
  const count = point.hasFileChanges ? Math.max(1, point.numFileSnapshots) : 0
  return {
    canRewind: true,
    supportsCodeOnly: true,
    filesChanged: count > 0 ? Array.from({ length: count }, (_, index) => `file-${index + 1}`) : [],
  }
}

function resultFromExecute(raw: unknown): RewindFilesResult {
  const record = unwrap(raw)
  if (!record) return { canRewind: false, supportsCodeOnly: true, error: 'empty rewind response' }
  if (record.success !== true) {
    const error = typeof record.error === 'string' && record.error.trim()
      ? record.error.trim()
      : 'Grok rewind failed'
    return { canRewind: false, supportsCodeOnly: true, error }
  }
  const reverted = Array.isArray(record.revertedFiles) ? record.revertedFiles : Array.isArray(record.reverted_files) ? record.reverted_files : []
  const clean = Array.isArray(record.cleanFiles) ? record.cleanFiles : Array.isArray(record.clean_files) ? record.clean_files : []
  const files = [...reverted, ...clean].filter((path): path is string => typeof path === 'string' && path.length > 0)
  return { canRewind: true, supportsCodeOnly: true, ...(files.length > 0 ? { filesChanged: files } : {}) }
}

export type GrokRewindRequest = 'preview' | GrokRewindMode

/** One rewind against an already loaded Grok session. */
export async function requestGrokRewind(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
  promptIndex: number,
  mode: GrokRewindRequest,
): Promise<RewindFilesResult> {
  if (mode === 'preview') {
    return previewFromPoints(parseGrokRewindPoints(await request(wire(XAI_REWIND_POINTS), { sessionId })), promptIndex)
  }
  return resultFromExecute(await request(wire(XAI_REWIND_EXECUTE), {
    sessionId,
    targetPromptIndex: promptIndex,
    force: true,
    mode,
  }))
}

/** Spawn Grok, `session/load` the stored id, rewind, then kill the process. */
export async function rewindLoadedGrokSession(opts: {
  launch: AcpLaunch
  cwd: string
  providerSessionId: string
  clientVersion?: string
  promptIndex: number
  mode: GrokRewindRequest
}): Promise<RewindFilesResult> {
  const processHandle = spawnAcpProcess({ ...opts.launch, cwd: opts.cwd })
  try {
    const connection = client({ name: 'superone-node' }).connect(processHandle.stream)
    await initializeAcpAgent(connection, true, { clientVersion: opts.clientVersion })
    await connection.agent.request(methods.agent.session.load, {
      sessionId: opts.providerSessionId,
      cwd: opts.cwd,
      mcpServers: [],
      _meta: { clientIdentifier: 'superone', noReplay: true },
    })
    return await requestGrokRewind(
      (method, params) => connection.agent.request(method, params),
      opts.providerSessionId,
      opts.promptIndex,
      opts.mode,
    )
  } catch (error) {
    return {
      canRewind: false,
      supportsCodeOnly: true,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    try { await processHandle.kill() } catch { /* already gone */ }
  }
}
