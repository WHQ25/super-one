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
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactPutRequest, ArtifactPutResult, ArtifactStatResult } from '@superone/shared/environment'
import type { ArtifactRef } from '../mcp/artifact-registry'
import { zoneRelativePath } from '../media-output-paths'
import { uploadArtifact, type TransferOutcome } from './artifact-transfer'
import { mirrorNodeArtifact } from './session-file-mirror'
import { mapNodeZoneArgs, mentionsArtifactPath, nodeZonePath, rewriteArtifactPaths, type NodeSyncZone } from './sync-zone-paths'

/** Left for the response itself after the uploads (§4.1). */
export const CLAIM_BUDGET_MARGIN_MS = 10_000
/** Longest single renewal to ask for; the node caps it at the action's deadline anyway. */
export const MAX_CLAIM_RENEWAL_MS = 60_000
/** Slack over the estimate when renewing, so a slightly slow link does not immediately re-defer. */
const RENEWAL_SLACK = 2

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
    defer(input: { connectionId: string; sessionId: string; localPath: string; relativePath: string; transferId?: string }): unknown
  }
  /**
   * Ask the node to extend this action's claim, returning the new expiry
   * (§4.1). Absent for an older node — then a file that does not fit is
   * deferred, as before.
   */
  renewClaim?: (ttlMs: number) => Promise<number>
  now?: () => number
  log?: { warn: (...args: unknown[]) => void }
}

/** Rejects when the budget runs out, so a hung RPC cannot hold the reply. */
function budgetExpiry(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('exceeded the claim budget'), { code: 'budget_exceeded' }))
    if (signal.aborted) { fail(); return }
    signal.addEventListener('abort', fail, { once: true })
  })
}

/**
 * Run `work` under a deadline of `ms`, also ending at the action's abort.
 * Every wait in this file is a race, never a plain await: a node RPC does not
 * return because we stopped wanting it, so awaiting one without a deadline
 * spends exactly the claim the deadline exists to protect. `work` is handed
 * the budget signal so it can stop its own I/O too.
 */
async function within<T>(ms: number, signal: AbortSignal, work: (budget: AbortSignal) => Promise<T>): Promise<T> {
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), Math.max(0, ms))
  const abortWithAction = () => budget.abort()
  signal.addEventListener('abort', abortWithAction, { once: true })
  try {
    return await Promise.race([work(budget.signal), budgetExpiry(budget.signal)])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abortWithAction)
  }
}

const NO_ARGS: ReadonlySet<string> = new Set()
const DIR_ARG: ReadonlySet<string> = new Set(['dir'])

interface ArgRoles {
  /** Arguments that name where the tool will write; these may not exist yet. */
  outputs: ReadonlySet<string>
  /**
   * Arguments that name a directory the tool will read. The zone syncs files:
   * `artifact.stat` on a directory answers "not there" whether or not it is,
   * so such an argument cannot be honoured from a remote session and is
   * refused as unsupported rather than reported missing.
   */
  directorySources: ReadonlySet<string>
}

/**
 * The roles a tool's arguments play, keyed by the name the *node* publishes.
 * The desktop splits `browser_network` into `browser_download` only after the
 * inputs are mapped, so it is the public name and its `action` that arrive
 * here. Everything not listed is a source file and has to exist on the node
 * before the tool runs — otherwise it runs on whatever copy happens to be at
 * the desktop path (§3.1). A tool that gains an output or directory argument
 * needs a line here.
 */
function argRoles(toolName: string | undefined, args: Record<string, unknown>): ArgRoles {
  switch (toolName) {
    case 'browser_network':
      return { outputs: args.action === 'download' ? DIR_ARG : NO_ARGS, directorySources: NO_ARGS }
    case 'browser_download':
      return { outputs: DIR_ARG, directorySources: NO_ARGS }
    case 'miniapp_dev_setup':
      return { outputs: new Set(['directory', 'projectDir']), directorySources: NO_ARGS }
    case 'miniapp_dev_register':
      return { outputs: new Set(['projectDir']), directorySources: new Set(['directory']) }
    case 'miniapp_dev_pack':
      return { outputs: new Set(['outputDir']), directorySources: new Set(['appDir']) }
    case 'miniapp_dev_update_types':
      return { outputs: NO_ARGS, directorySources: new Set(['appDir']) }
    default:
      return { outputs: NO_ARGS, directorySources: NO_ARGS }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('host action aborted'), { code: 'aborted' })
}

/** §3.1 — reverse-map node zone paths in the args, mirroring each one first. */
export async function mapHostActionInputs(
  args: Record<string, unknown>,
  deps: Pick<HostActionSyncDeps, 'zone' | 'get' | 'stat' | 'signal'> & { sessionId?: string; toolName?: string },
): Promise<Record<string, unknown>> {
  const mapped = mapNodeZoneArgs(deps.zone, args, deps.sessionId)
  const roles = argRoles(deps.toolName, args)
  for (const ref of mapped.refs) {
    if (ref.keys.some((key) => roles.directorySources.has(key))) {
      throw Object.assign(
        new Error(
          `${ref.relativePath} is a directory under the session directory, and the session directory syncs files, not directories; `
          + `${deps.toolName} cannot take it from a remote session`,
        ),
        { code: 'unsupported' },
      )
    }
    // A path is only "allowed to be new" if every role it was given is a
    // destination. Named once as a source, it is a source.
    const outputOnly = ref.keys.length > 0 && ref.keys.every((key) => roles.outputs.has(key))
    const outcome = await mirrorNodeArtifact(ref.sessionId, ref.relativePath, { stat: deps.stat, get: deps.get, signal: deps.signal })
    throwIfAborted(deps.signal)
    // The node has it and would not hand it over: running the tool on
    // whatever is at the desktop path would be running it on the wrong bytes.
    if (outcome.kind === 'unavailable') {
      throw Object.assign(
        new Error(`could not fetch ${ref.relativePath} from the node: ${outcome.reason}`),
        { code: 'unavailable' },
      )
    }
    // Not there at all. Only a declared destination is allowed to be new —
    // for a source this is the same stale-copy hazard wearing another code.
    if (outcome.kind === 'missing' && !outputOnly) {
      throw Object.assign(
        new Error(`${ref.relativePath} is not in this session's directory on the node`),
        { code: 'not_found' },
      )
    }
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

/**
 * Is the path named anywhere in the reply? Asked block by block, because the
 * rewrite runs block by block: joining them first changes the parse — two
 * JSON blocks joined are not JSON — so the two would answer differently about
 * the same reply, and a ref the rewrite would have redirected was never
 * uploaded.
 */
function mentionedInReply(reply: ToolReply, path: string): boolean {
  return (reply.content ?? []).some((block) => typeof block.text === 'string' && mentionsArtifactPath(block.text, path))
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
  const planned: PlannedRef[] = []
  for (const ref of refs) {
    if (!ref.final) continue
    const zone = zoneRelativePath(ref.path)
    if (!zone || zone.sessionId !== sessionId) continue
    const nodePath = nodeZonePath(deps.zone, zone.sessionId, zone.relativePath)
    // The same matcher on the same text the rewrite will see.
    if (!mentionedInReply(reply, ref.path)) continue
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

  let expiresAt = claimExpiresAt
  for (const item of planned) {
    mapping.set(item.ref.path, item.nodePath)
    // One transferId for the file's whole life: the node keeps a half-written
    // transfer open after a dropped connection, and a job retrying under a new
    // id would be told `busy` by it. The job carries this id and resumes.
    const transferId = randomUUID()
    const job = { connectionId: deps.connectionId, sessionId: item.sessionId, localPath: item.ref.path, relativePath: item.relativePath, transferId }
    const estimateMs = item.size / rate
    if (estimateMs > expiresAt - now() - CLAIM_BUDGET_MARGIN_MS && deps.renewClaim) {
      // Buying time beats handing the agent an ENOENT it has to wait out.
      try {
        const ask = Math.min(MAX_CLAIM_RENEWAL_MS, Math.ceil(estimateMs * RENEWAL_SLACK) + CLAIM_BUDGET_MARGIN_MS)
        // Bounded by the claim we still hold: a renewal that never answers
        // would otherwise be waited out past the very claim it was protecting.
        expiresAt = await within(expiresAt - now() - CLAIM_BUDGET_MARGIN_MS, deps.signal, () => deps.renewClaim!(ask))
      } catch (err) {
        deps.log?.warn('[host-action] claim renewal refused, deferring', item.relativePath, err instanceof Error ? err.message : String(err))
      }
      throwIfAborted(deps.signal)
    }
    const budgetMs = expiresAt - now() - CLAIM_BUDGET_MARGIN_MS
    if (estimateMs > budgetMs) {
      deps.transfers.defer(job)
      deferred.push(item.nodePath)
      continue
    }
    // The upload gets the budget as a hard stop of its own: an estimate is not
    // a guarantee, and running past the claim loses the reply as well.
    try {
      // The transfer keeps its id when the budget cuts it off, so the job
      // resumes the partial upload rather than starting a second one.
      const outcome = await within(budgetMs, deps.signal, (budgetSignal) => uploadArtifact({
        localPath: item.ref.path,
        sessionId: item.sessionId,
        relativePath: item.relativePath,
        transferId,
        put: deps.put,
        signal: budgetSignal,
      }))
      deps.transfers.recordThroughput(deps.connectionId, outcome)
    } catch (err) {
      throwIfAborted(deps.signal)
      // The tool already did its work; a failed push must not fail the action.
      // Hand the file to a job and tell the agent it is not there yet.
      deps.log?.warn('[host-action] eager artifact push failed, deferring', item.relativePath, err instanceof Error ? err.message : String(err))
      deps.transfers.defer(job)
      deferred.push(item.nodePath)
    }
    throwIfAborted(deps.signal)
  }

  const content = (reply.content ?? []).map((block) =>
    typeof block.text === 'string' ? { ...block, text: rewriteArtifactPaths(block.text, mapping) } : block,
  )
  if (deferred.length === 0) return { ...reply, content }
  // The node's MCP server forwards `content` and nothing else of the envelope,
  // so the deferred list has to be content too or the model only ever sees
  // the ENOENT (§4.1).
  return {
    ...reply,
    content: [...content, { type: 'text', text: deferredNotice(deferred) }],
    sync: { deferred },
  }
}

function deferredNotice(paths: string[]): string {
  return [
    `SuperOne sync: ${paths.length === 1 ? 'this file is' : 'these files are'} still being transferred to this machine and not yet available at the path shown:`,
    ...paths.map((p) => `- ${p}`),
    'You will be notified when the transfer completes; reading the path before that fails with ENOENT.',
  ].join('\n')
}
