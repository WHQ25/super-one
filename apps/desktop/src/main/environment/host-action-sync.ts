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
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactListRequest, ArtifactListResult, ArtifactPutRequest, ArtifactPutResult, ArtifactStatResult } from '@superone/shared/environment'
import type { ArtifactRef } from '../mcp/artifact-registry'
import { releaseHeldDeliveries } from '../mcp/artifact-registry'
import { zoneRelativePath } from '../media-output-paths'
import { uploadArtifact, type TransferOutcome } from './artifact-transfer'
import {
  abandonDelivery,
  advanceDelivery,
  claimDelivery,
  completeDelivery,
  getDelivery,
  recordDeliveryFailure,
  recordDeliveryOffset,
  releaseDelivery,
  type Delivery,
  type DeliveryHandle,
} from '../db-session-deliveries'
import { isHolderAlive, mintHolder, retireHolder } from './delivery-holders'
import { mirrorNodeArtifact, mirrorNodeDirectory } from './session-file-mirror'
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
  /** Every file under a zone directory (§3.1); absent for a node that predates it. */
  list?: (input: ArtifactListRequest) => Promise<ArtifactListResult>
  transfers: {
    throughputBytesPerMs(connectionId: string): number
    recordThroughput(connectionId: string, outcome: TransferOutcome): void
    /** A row was left for the worker; it need not wait for its next timer. */
    wake(connectionId: string): void
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
  // An already-cancelled action raises no new abort event, so a listener alone
  // would wait the full budget for something that already happened.
  if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' })
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), Math.max(0, ms))
  const abortWithAction = () => budget.abort()
  signal.addEventListener('abort', abortWithAction, { once: true })
  // A work that has ALREADY finished is honoured even if the deadline fires in
  // the same tick — an abort landing on a final put's reply must not discard a
  // commit the node confirmed and report it as needing re-delivery (§6). The
  // deadline still wins over a work that is merely slow or hung: on expiry we
  // give the settled result one macrotask to surface, no longer.
  let done: { value: T } | { error: unknown } | null = null
  const task = work(budget.signal).then((value) => void (done ??= { value }), (error) => void (done ??= { error }))
  try {
    await Promise.race([task, budgetExpiry(budget.signal)])
  } catch (deadline) {
    await Promise.race([task, new Promise((resolve) => setTimeout(resolve, 0))])
    if (!done) throw deadline
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abortWithAction)
  }
  const settled = done!
  if ('error' in settled) throw settled.error
  return settled.value
}

const NO_ARGS: ReadonlySet<string> = new Set()
const DIR_ARG: ReadonlySet<string> = new Set(['dir'])

interface ArgRoles {
  /** Arguments that name where the tool will write; these may not exist yet. */
  outputs: ReadonlySet<string>
  /**
   * Arguments that name a directory the tool will read. `artifact.stat` knows
   * files, so a directory is answered by listing it and mirroring every
   * member (`mirrorNodeDirectory`) before the tool runs.
   */
  directorySources: ReadonlySet<string>
  /**
   * Arguments that hold *another* tool's arguments — `browser_perf.action`
   * carries the call it measures, and a saved `browser_action`'s `input`
   * only becomes arguments after template expansion. Their purpose is not
   * knowable here, so they are left as written and mapped where the inner
   * tool actually runs (`mapNestedToolInputs`), by that tool's own roles.
   */
  deferred: ReadonlySet<string>
}

const NO_ROLES: ArgRoles = { outputs: NO_ARGS, directorySources: NO_ARGS, deferred: NO_ARGS }

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
      return { ...NO_ROLES, outputs: args.action === 'download' ? DIR_ARG : NO_ARGS }
    case 'browser_download':
      return { ...NO_ROLES, outputs: DIR_ARG }
    // The compact dispatcher re-issues each public wrapper under an internal
    // name (`browser_perf` → `browser_perf_measure`, `browser_action` →
    // `browser_action_save` / `_do`), and the mapping runs again there. The
    // internal name has to defer the same arguments, or the second pass
    // judges what the first one deliberately left alone.
    case 'browser_perf':
    case 'browser_perf_measure':
      return { ...NO_ROLES, deferred: new Set(['action']) }
    case 'browser_action':
    case 'browser_action_save':
    case 'browser_action_do':
      // `input` feeds a saved flow's templates; `steps` and `parameters`
      // (whose defaults feed the same templates) *are* a flow being saved —
      // definition data, whose paths are resolved on each run, not mirrored
      // once and frozen at the version the save happened to see.
      return { ...NO_ROLES, deferred: new Set(['input', 'steps', 'parameters']) }
    case 'miniapp_dev_setup':
      return { ...NO_ROLES, outputs: new Set(['directory', 'projectDir']) }
    case 'miniapp_dev_register':
      return { ...NO_ROLES, outputs: new Set(['projectDir']), directorySources: new Set(['directory']) }
    case 'miniapp_dev_pack':
      return { ...NO_ROLES, outputs: new Set(['outputDir']), directorySources: new Set(['appDir']) }
    case 'miniapp_dev_update_types':
      return { ...NO_ROLES, directorySources: new Set(['appDir']) }
    default:
      return NO_ROLES
  }
}

type InputMappingDeps = Pick<HostActionSyncDeps, 'zone' | 'get' | 'stat' | 'list' | 'signal'> & { sessionId?: string; connectionId?: string }

/**
 * The Host Action whose tool is running, for the tools it dispatches in
 * turn. Set once around the outer call; read by `mapNestedToolInputs` from
 * wherever a wrapper reaches its inner tool, however many frames down.
 */
const nestedMapping = new AsyncLocalStorage<InputMappingDeps>()

/** Run a Host Action's tool with its input mapping reachable by nested dispatch. */
export function withInputMapping<T>(deps: InputMappingDeps, run: () => Promise<T>): Promise<T> {
  return nestedMapping.run(deps, run)
}

/**
 * Map the arguments a wrapper hands to an inner tool, by the inner tool's
 * own roles — the point where `browser_perf`'s measured call or a saved
 * action's expanded step actually becomes a `browser_download`. A no-op
 * outside a Host Action, and for arguments already mapped: a desktop path
 * does not parse as a node zone path, so mapping twice is mapping once.
 */
export async function mapNestedToolInputs(toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const deps = nestedMapping.getStore()
  return deps ? mapHostActionInputs(args, { ...deps, toolName }) : args
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('host action aborted'), { code: 'aborted' })
}

/** §3.1 — reverse-map node zone paths in the args, mirroring each one first. */
export async function mapHostActionInputs(
  args: Record<string, unknown>,
  deps: InputMappingDeps & { toolName?: string },
): Promise<Record<string, unknown>> {
  const roles = argRoles(deps.toolName, args)
  const mapped = mapNodeZoneArgs(deps.zone, args, deps.sessionId, roles.deferred)
  const mirrorDeps = { connectionId: deps.connectionId, stat: deps.stat, get: deps.get, list: deps.list, signal: deps.signal }
  for (const ref of mapped.refs) {
    // A path is only "allowed to be new" if every role it was given is a
    // destination. Named once as a source, it is a source.
    const outputOnly = ref.keys.length > 0 && ref.keys.every((key) => roles.outputs.has(key))
    const outcome = ref.keys.some((key) => roles.directorySources.has(key))
      ? await mirrorNodeDirectory(ref.sessionId, ref.relativePath, mirrorDeps)
      : await mirrorNodeArtifact(ref.sessionId, ref.relativePath, mirrorDeps)
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
  delivery: Delivery
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

/** The eager push lost its row mid-step: the session was dropped, or another holder took it. */
class LostDelivery extends Error {
  constructor() {
    super('delivery lost to another holder')
    this.name = 'LostDelivery'
  }
}

/**
 * §3 + §4.1 — push the registered outputs, rewrite the reply, defer what does
 * not fit. Returns the rewritten reply; `sync.deferred` lists node paths that
 * are not there yet.
 *
 * Every ref is a delivery record (`docs/design/session-sync-zone-delivery-record.md`),
 * and the record says what there is to do: a row already at `uploaded` or
 * later needs nothing sent — the node has it — and a row someone else holds
 * is being delivered by them. Only a `sealed` row nobody holds is this call's
 * to push, and it pushes it under a holder of its own, through the same
 * `committing` gate the worker uses, to `done`: for an eager push the reply
 * itself is the wake. Anything it cannot finish inside the budget it leaves
 * for the worker at the phase it reached, and reports as deferred.
 */
export async function syncHostActionOutputs(
  sessionId: string,
  refs: ArtifactRef[],
  /**
   * The deliveries this call sealed and is still holding, by delivery id
   * (E090-4). Kept live across the scope end so the worker cannot take an
   * undecided file; this function owns each one now — it pushes a mentioned
   * file under the same handle, abandons an unmentioned one, and releases the
   * rest to the worker in its `finally`.
   */
  held: Map<string, DeliveryHandle>,
  reply: ToolReply,
  claimExpiresAt: number,
  deps: HostActionSyncDeps,
): Promise<ToolReply> {
  const now = deps.now ?? Date.now
  // A held handle is "consumed" once this function has taken responsibility for
  // retiring its holder (pushed it, or abandoned it). Everything else is
  // released to the worker on the way out — including files an abort never
  // reached, which stay sealed and unheld for it.
  const consumed = new Set<string>()
  const releaseLeftover = (): void =>
    releaseHeldDeliveries([...held].filter(([id]) => !consumed.has(id)).map(([, handle]) => handle))
  try {
    const planned: PlannedRef[] = []
    for (const ref of refs) {
      if (!ref.final) continue
      const zone = zoneRelativePath(ref.path)
      if (!zone || zone.sessionId !== sessionId) continue
      if (!ref.deliveryId) {
        deps.log?.warn('[host-action] a zone file was registered without a delivery record; not pushed', ref.path)
        continue
      }
      const delivery = getDelivery(ref.deliveryId)
      if (!delivery) continue
      // The same matcher on the same text the rewrite will see.
      if (!mentionedInReply(reply, ref.path)) {
        // Named by nothing the agent will read — a `browser_perf_measure` that ran
        // a download and reported only its timings. If we still HOLD it from this
        // call, abandon it under that handle; the retire is guaranteed even if the
        // abandon write throws. A ref we do NOT hold is an observation of someone
        // else's delivery — a page or background download the worker has not yet
        // carried is sealed and unheld too — so we skip it. A call's authority to
        // abandon comes only from a handle it owns, never an id-only claim on a
        // row that merely happens to be free (E090-4).
        const mine = held.get(delivery.deliveryId)
        if (mine) {
          try {
            abandonDelivery(mine)
          } finally {
            retireHolder(mine.holder)
            consumed.add(delivery.deliveryId)
          }
        }
        continue
      }
      const nodePath = nodeZonePath(deps.zone, zone.sessionId, zone.relativePath)
      planned.push({ ref, sessionId: zone.sessionId, relativePath: zone.relativePath, nodePath, size: delivery.total, delivery })
    }
    if (planned.length === 0) return reply

    const mapping = new Map<string, string>()
    const deferred: string[] = []
    // Files whose final chunk was sent but not confirmed (§6): no worker will
    // retry them, so the agent is told they stopped, not that they are on the way.
    const stopped: string[] = []
    // Files whose automatic upload gave up before the final put (retries
    // exhausted): the worker's own query excludes gave-up rows, so they are
    // neither on their way nor a lost commit — only a person's Retry Upload
    // recovers them (E090-3).
    const retryRequired: string[] = []
    const rate = Math.max(1, deps.transfers.throughputBytesPerMs(deps.connectionId))
    // Smallest first: a screenshot should never wait behind a recording.
    planned.sort((a, b) => a.size - b.size)

    let expiresAt = claimExpiresAt
    let leftForWorker = false
    for (const item of planned) {
      // A cancel that landed during the previous item's push: nothing further
      // is claimed, so the rest stays `sealed` and unheld for the worker.
      throwIfAborted(deps.signal)
      const row = item.delivery
      // The live handle this call is still holding for the row, if any: the row
      // is then `sealed` with our holder, ours to push under it.
      const mine = held.get(row.deliveryId)
      const ours = mine != null && row.holder === mine.holder && row.epoch === mine.epoch
      // The producer's failure: the file is not going to exist on the node, and
      // the reply the tool wrote already says what happened to it.
      if (row.outcome === 'abandoned') continue
      mapping.set(item.ref.path, item.nodePath)
      // The node has it (done, or only the wake is owed — the worker's).
      if (row.outcome === 'done' || row.phase === 'uploaded' || row.phase === 'notifying') continue
      // A `committing` row's final put was sent (§6). Under a LIVE holder it is
      // its executor finishing that put right now — it will complete and wake the
      // agent, so report it on its way (deferred), not stopped. Only a committing
      // row whose holder is gone had its put sent and lost, with no worker to
      // retry it: that one is `stopped`, and stays stopped when observed again
      // (E090-3). A row that gave up in an EARLIER phase falls through — its bytes
      // were never a sent-but-unconfirmed put, so it must not borrow the "re-run"
      // message; a person can still retry it from Settings.
      if (row.phase === 'committing') {
        if (isHolderAlive(row.holder)) deferred.push(item.nodePath)
        else stopped.push(item.nodePath)
        continue
      }
      // Gave up before the final put (retries exhausted, or the local file went
      // missing and came back): its bytes were never sent, so it is not stopped
      // (§6) — but the worker will not carry a gave-up row either, so it is not
      // deferred. It needs a person: Settings → Retry Upload. Do not wake a
      // worker that will skip it (E090-3).
      if (row.gaveUpAt != null) {
        retryRequired.push(item.nodePath)
        continue
      }
      // Being delivered by someone else, or already the worker's — an upload in
      // progress, a queued one. Joining them IS the action. A live holder that
      // is OURS is not someone else: it is the grip we kept across the scope
      // end, and this is the push it was kept for (E090-4).
      if (row.phase !== 'sealed' || (isHolderAlive(row.holder) && !ours)) {
        deferred.push(item.nodePath)
        leftForWorker = true
        continue
      }
      // Ours to push, if the budget allows. If we still hold it from the call,
      // push under that live handle — no fresh claim, so the worker never had a
      // sealed, unheld row to race (E090-4). Otherwise (a row sealed outside any
      // call that reached here) claim it before any await.
      let holder: string
      let handle: DeliveryHandle
      if (ours) {
        holder = mine!.holder
        handle = mine!
        consumed.add(row.deliveryId)
      } else {
        holder = mintHolder()
        const claimed = claimDelivery(row.deliveryId, { holder: row.holder, epoch: row.epoch }, holder)
        if (!claimed.ok) {
          retireHolder(holder)
          deferred.push(item.nodePath)
          leftForWorker = true
          continue
        }
        handle = claimed.handle
      }
      // The handle moves as the phase does; the failure path has to record
      // against the epoch actually reached, or it records nothing.
      const cursor: PushCursor = { handle, committing: false }
      try {
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
          // Not attempted: queued for the worker, still complete, still protected.
          const queued = advanceDelivery(cursor.handle, { from: 'sealed', to: 'queued' })
          if (queued.ok) releaseDelivery(queued.handle)
          deferred.push(item.nodePath)
          leftForWorker = true
          continue
        }
        const started = advanceDelivery(cursor.handle, { from: 'sealed', to: 'uploading' })
        if (!started.ok) throw new LostDelivery()
        cursor.handle = started.handle
        // The upload gets the budget as a hard stop of its own: an estimate is
        // not a guarantee, and running past the claim loses the reply as well.
        // The transfer keeps its id when the budget cuts it off, so the worker
        // resumes the partial upload rather than starting a second one.
        await within(budgetMs, deps.signal, (budgetSignal) => pushDelivery(row, cursor, budgetSignal, deps))
        // For an eager push the reply is the wake: the agent reads the rewritten
        // path in the same turn. Done, under this holder. The cursor tracks the
        // notifying handle so a completeDelivery that throws records against the
        // epoch actually reached — as an ordinary retry, the bytes being on the
        // node already (E090-2).
        const notifying = advanceDelivery(cursor.handle, { from: 'uploaded', to: 'notifying' })
        if (!notifying.ok) throw new LostDelivery()
        cursor.handle = notifying.handle
        if (!completeDelivery(cursor.handle)) throw new LostDelivery()
      } catch (err) {
        if (err instanceof LostDelivery) {
          deferred.push(item.nodePath)
          continue
        }
        // The tool already did its work; a failed push must not fail the action.
        // The row keeps the phase it reached and the worker takes it from there:
        // `uploading` with its offset is resumed; a wake that failed after the
        // commit was confirmed retries the wake (cursor.committing was cleared at
        // `uploaded`); only a final put still in flight — `committing` — is
        // unknowable from here and stops (§6). The agent is told it is not there yet.
        const message = err instanceof Error ? err.message : String(err)
        recordDeliveryFailure(cursor.handle, { error: cursor.committing ? `commit unverified: ${message}` : message, nextAttemptAt: cursor.committing ? null : now() })
        if (cursor.committing) {
          // Final put in flight and unconfirmed: the worker will not touch it, so
          // do not wake one, and tell the agent it stopped rather than promise a
          // completion notice that will never come.
          stopped.push(item.nodePath)
        } else {
          deferred.push(item.nodePath)
          leftForWorker = true
        }
        // The action was cancelled, not the push: the row already records where
        // it got to (§6), and the failure surfaced as the action's abort.
        throwIfAborted(deps.signal)
        deps.log?.warn('[host-action] eager artifact push failed', item.relativePath, message)
      } finally {
        retireHolder(holder)
      }
      throwIfAborted(deps.signal)
    }
    if (leftForWorker) deps.transfers.wake(deps.connectionId)
    const content = (reply.content ?? []).map((block) =>
      typeof block.text === 'string' ? { ...block, text: rewriteArtifactPaths(block.text, mapping) } : block,
    )
    if (deferred.length === 0 && stopped.length === 0 && retryRequired.length === 0) return { ...reply, content }
    // The node's MCP server forwards `content` and nothing else of the envelope,
    // so every list has to be content too or the model only ever sees the ENOENT
    // (§4.1) — and it must be able to tell "on its way" from "stopped, re-run"
    // from "gave up, retry from Settings".
    const notices = [
      ...(deferred.length ? [{ type: 'text' as const, text: deferredNotice(deferred) }] : []),
      ...(stopped.length ? [{ type: 'text' as const, text: stoppedNotice(stopped) }] : []),
      ...(retryRequired.length ? [{ type: 'text' as const, text: retryRequiredNotice(retryRequired) }] : []),
    ]
    return {
      ...reply,
      content: [...content, ...notices],
      sync: { deferred, ...(stopped.length ? { stopped } : {}), ...(retryRequired.length ? { retryRequired } : {}) },
    }
  } finally {
    // Every held handle this call took is accounted for on every path: pushed
    // and retired, abandoned and retired, or — for anything the body did not
    // reach (a DB error before the decision, an abort part way, a ref filtered
    // out) — released to the worker here, never left as a live holder (E090-4).
    releaseLeftover()
  }
}

/** Where a push has got to, visible to its failure path. */
interface PushCursor {
  handle: DeliveryHandle
  /** The `committing` gate has been written: the final put is, or was, in flight. */
  committing: boolean
}

/**
 * Send one sealed file under the cursor's handle, through the `committing`
 * gate, to `uploaded`. The gate is written immediately before the final chunk
 * — for an empty file, a single chunk, a resumed last chunk alike — and a
 * gate that cannot be written sends nothing.
 */
async function pushDelivery(row: Delivery, cursor: PushCursor, signal: AbortSignal, deps: HostActionSyncDeps): Promise<void> {
  const outcome = await uploadArtifact({
    localPath: row.localPath,
    sessionId: row.sessionId,
    relativePath: row.relativePath,
    transferId: row.transferId,
    ...(row.sha256 ? { identity: { total: row.total, sha256: row.sha256 } } : {}),
    put: deps.put,
    signal,
    onProgress: (offset) => void recordDeliveryOffset(cursor.handle, offset),
    beforeFinal: () => {
      // Idempotent: an offset resync can re-send a final chunk.
      if (cursor.committing) return
      const gate = advanceDelivery(cursor.handle, { from: 'uploading', to: 'committing' })
      if (!gate.ok) throw new LostDelivery()
      cursor.handle = gate.handle
      cursor.committing = true
    },
  })
  deps.transfers.recordThroughput(deps.connectionId, outcome)
  const landed = advanceDelivery(cursor.handle, { from: 'committing', to: 'uploaded' })
  if (!landed.ok) throw new LostDelivery()
  cursor.handle = landed.handle
  // The commit is confirmed on the node: `committing` no longer describes the
  // row, so a later failure (the wake) is an ordinary retry, never reported as
  // "commit unverified" for bytes already delivered (E090-2).
  cursor.committing = false
}

function deferredNotice(paths: string[]): string {
  return [
    `SuperOne sync: ${paths.length === 1 ? 'this file is' : 'these files are'} still being transferred to this machine and not yet available at the path shown:`,
    ...paths.map((p) => `- ${p}`),
    'You will be notified when the transfer completes; reading the path before that fails with ENOENT.',
  ].join('\n')
}

function stoppedNotice(paths: string[]): string {
  return [
    `SuperOne sync: the transfer of ${paths.length === 1 ? 'this file' : 'these files'} was interrupted after the final chunk was sent and could not be confirmed, so ${paths.length === 1 ? 'it is' : 'they are'} not available at the path shown and will NOT be retried automatically:`,
    ...paths.map((p) => `- ${p}`),
    'Re-run the action that produced ' + (paths.length === 1 ? 'it' : 'them') + ' to deliver again; you will not be notified about the stopped transfer.',
  ].join('\n')
}

function retryRequiredNotice(paths: string[]): string {
  return [
    `SuperOne sync: the automatic upload of ${paths.length === 1 ? 'this file' : 'these files'} exhausted its retries and stopped, so ${paths.length === 1 ? 'it is' : 'they are'} not available at the path shown and will NOT be retried automatically:`,
    ...paths.map((p) => `- ${p}`),
    'Retry from Settings → Session Storage → Retry Upload; you will not be notified until then.',
  ].join('\n')
}
