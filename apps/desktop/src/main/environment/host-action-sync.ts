/**
 * The executor's two sync steps around one Host Action
 * (`docs/design/session-sync-zone.md` §3, §3.1, §4.1).
 *
 * Inputs: every string arg under the node zone is mapped to its desktop
 * mirror, fetched first if the desktop does not have it yet — this is what
 * lets an `@native/image-gallery` call name a file the agent wrote on the node.
 *
 * Outputs: every `final` artifact the tool registered *and named in its reply*
 * is pushed to the node inside the claim budget, and its desktop path is
 * rewritten to the node twin by exact string replacement. Refs that do not
 * fit the budget become transfer jobs; the path is rewritten anyway and the
 * reply gains `sync.deferred` so the agent's ENOENT is honest. A ref the reply
 * never mentions is not pushed: the agent has no path to `Read`, and the
 * desktop, the renderer and the phone read the desktop copy.
 */
import { statSync } from 'node:fs'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactPutRequest, ArtifactPutResult, ArtifactStatResult } from '@superone/shared/environment'
import type { ArtifactRef } from '../mcp/artifact-registry'
import { zoneRelativePath } from '../media-output-paths'
import { uploadArtifact, type TransferOutcome } from './artifact-transfer'
import { mirrorNodeArtifact } from './session-file-mirror'
import { mapNodeZoneArgs, nodeZonePath, rewriteArtifactPaths, type NodeSyncZone } from './sync-zone-paths'

/** Left for the response itself after the uploads (§4.1). */
export const CLAIM_BUDGET_MARGIN_MS = 10_000

export interface ToolReply {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>
  isError?: boolean
  [key: string]: unknown
}

export interface HostActionSyncDeps {
  zone: NodeSyncZone
  connectionId: string
  signal: AbortSignal
  put: (input: ArtifactPutRequest) => Promise<ArtifactPutResult>
  get: (input: ArtifactGetRequest) => Promise<ArtifactGetResult>
  stat: (input: { sessionId: string; relativePath: string }) => Promise<ArtifactStatResult>
  transfers: {
    throughputBytesPerMs(connectionId: string): number
    recordThroughput(connectionId: string, outcome: TransferOutcome): void
    defer(input: { connectionId: string; sessionId: string; localPath: string; relativePath: string }): unknown
  }
  now?: () => number
  log?: { warn: (...args: unknown[]) => void }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('host action aborted'), { code: 'aborted' })
}

/** §3.1 — reverse-map node zone paths in the args, mirroring each one first. */
export async function mapHostActionInputs(
  args: Record<string, unknown>,
  deps: Pick<HostActionSyncDeps, 'zone' | 'get' | 'stat' | 'signal'>,
): Promise<Record<string, unknown>> {
  const mapped = mapNodeZoneArgs(deps.zone, args)
  for (const ref of mapped.refs) {
    await mirrorNodeArtifact(ref.sessionId, ref.relativePath, { stat: deps.stat, get: deps.get, signal: deps.signal })
    throwIfAborted(deps.signal)
  }
  return mapped.args as Record<string, unknown>
}

interface PlannedRef {
  ref: ArtifactRef
  sessionId: string
  relativePath: string
  nodePath: string
  size: number
}

function replyText(reply: ToolReply): string {
  return (reply.content ?? []).map((block) => (typeof block.text === 'string' ? block.text : '')).join('\n')
}

/**
 * §3 + §4.1 — push the registered outputs, rewrite the reply, defer what does
 * not fit. Returns the rewritten reply; `sync.deferred` lists node paths that
 * are not there yet.
 */
export async function syncHostActionOutputs(
  sessionId: string,
  refs: ArtifactRef[],
  reply: ToolReply,
  claimExpiresAt: number,
  deps: HostActionSyncDeps,
): Promise<ToolReply> {
  const now = deps.now ?? Date.now
  const text = replyText(reply)
  const planned: PlannedRef[] = []
  for (const ref of refs) {
    if (!ref.final) continue
    const zone = zoneRelativePath(ref.path)
    if (!zone || zone.sessionId !== sessionId) continue
    const nodePath = nodeZonePath(deps.zone, zone.sessionId, zone.relativePath)
    // Raw or JSON-escaped: whichever form the serialised reply carries.
    const mentioned = text.includes(ref.path) || text.includes(JSON.stringify(ref.path).slice(1, -1))
    if (!mentioned) continue
    let size: number
    try {
      size = statSync(ref.path).size
    } catch {
      continue
    }
    planned.push({ ref, sessionId: zone.sessionId, relativePath: zone.relativePath, nodePath, size })
  }
  if (planned.length === 0) return reply

  const mapping = new Map<string, string>()
  const deferred: string[] = []
  const rate = Math.max(1, deps.transfers.throughputBytesPerMs(deps.connectionId))
  // Smallest first: a screenshot should never wait behind a recording.
  planned.sort((a, b) => a.size - b.size)

  for (const item of planned) {
    mapping.set(item.ref.path, item.nodePath)
    const budgetMs = claimExpiresAt - now() - CLAIM_BUDGET_MARGIN_MS
    const estimateMs = item.size / rate
    if (estimateMs > budgetMs) {
      deps.transfers.defer({ connectionId: deps.connectionId, sessionId: item.sessionId, localPath: item.ref.path, relativePath: item.relativePath })
      deferred.push(item.nodePath)
      continue
    }
    try {
      const outcome = await uploadArtifact({
        localPath: item.ref.path,
        sessionId: item.sessionId,
        relativePath: item.relativePath,
        put: deps.put,
        signal: deps.signal,
      })
      deps.transfers.recordThroughput(deps.connectionId, outcome)
    } catch (err) {
      throwIfAborted(deps.signal)
      // The tool already did its work; a failed push must not fail the action.
      // Hand the file to a job and tell the agent it is not there yet.
      deps.log?.warn('[host-action] eager artifact push failed, deferring', item.relativePath, err instanceof Error ? err.message : String(err))
      deps.transfers.defer({ connectionId: deps.connectionId, sessionId: item.sessionId, localPath: item.ref.path, relativePath: item.relativePath })
      deferred.push(item.nodePath)
    }
    throwIfAborted(deps.signal)
  }

  const content = (reply.content ?? []).map((block) =>
    typeof block.text === 'string' ? { ...block, text: rewriteArtifactPaths(block.text, mapping) } : block,
  )
  return { ...reply, content, ...(deferred.length > 0 ? { sync: { deferred } } : {}) }
}
