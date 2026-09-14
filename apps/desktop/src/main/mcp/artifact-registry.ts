/**
 * Artifact references are registered, not discovered
 * (`docs/design/session-sync-zone.md` §3).
 *
 * A tool that writes a file the agent will be handed a path to registers it
 * here at the moment the file is complete. The Host Action executor collects
 * whatever a call registered and pushes those files to the node before the
 * reply goes back, rewriting the desktop path to its node twin. Nothing parses
 * the reply looking for paths.
 *
 * Refs are scoped to a *call*, not just a session: two Host Actions for one
 * session can run concurrently, and a screenshot taken by one must not be
 * pushed on behalf of the other. The scope rides on `AsyncLocalStorage`, so a
 * writer deep inside a tool needs only the session id. A callback that has
 * lost its async context (a listener on a long-lived emitter) is *not*
 * guessed onto another call's scope — that misfiles refs under concurrency;
 * such a call site wraps its listener with `bindArtifactScope`. Outside any
 * scope — local sessions, manual UI captures — registration is a no-op, so
 * nothing accumulates.
 */
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { retireHolder } from '../environment/delivery-holders'
import { releaseDelivery, type DeliveryHandle } from '../db-session-deliveries'
import { randomUUID } from 'node:crypto'
import log from '../logger'
import type { ArtifactProducer } from '../media-output-paths'

export interface ArtifactRef {
  /** Absolute desktop path. */
  path: string
  producer: ArtifactProducer
  /** False while the file is still being written (a recording that has started); re-registered when sealed. */
  final: boolean
  /**
   * The delivery record this file is (`docs/design/session-sync-zone-delivery-record.md`),
   * for a remote session's zone file. Absent for a local session or a path
   * outside the zone. Set by `publishArtifact`, never by a producer directly.
   */
  deliveryId?: string
}

interface Scope {
  sessionId: string
  callId: string
  /** Remote connection this call is a Host Action for; absent for a local session. */
  connectionId?: string
  refs: Map<string, ArtifactRef>
  /**
   * Deliveries this call sealed and is still holding. Kept alive so the worker
   * cannot take a produced file before the reply-selection decides whether the
   * agent will read it (E090-4). Released — holder set to null — when the scope
   * ends, after which the decision (push a mentioned ref, abandon an unmentioned
   * one) runs against an unheld row.
   */
  heldDeliveries: Map<string, DeliveryHandle>
  /**
   * True once the call has returned. A detached task the call started — a
   * backgrounded download that seals after the tool replied — keeps this scope
   * as its `AsyncLocalStorage` context, so `holdSealedDelivery` must read this
   * rather than "is a scope current": a seal after the call ended is nobody's
   * to hold and is released for the worker at once.
   */
  ended: boolean
}

const scopes = new Map<string, Scope>()
const current = new AsyncLocalStorage<Scope>()

function hasOpenScope(sessionId: string): boolean {
  for (const scope of scopes.values()) if (scope.sessionId === sessionId) return true
  return false
}

/** Record a file the session's caller may be handed a path to. Later registrations of one path replace earlier ones. */
export function registerArtifact(sessionId: string, ref: ArtifactRef): void {
  const bound = current.getStore()
  if (bound && bound.sessionId === sessionId) {
    // A re-registration that does not know the delivery (a status boundary
    // naming a path again) must not erase the one the producer recorded.
    const deliveryId = ref.deliveryId ?? bound.refs.get(ref.path)?.deliveryId
    bound.refs.set(ref.path, deliveryId ? { ...ref, deliveryId } : { ...ref })
    return
  }
  // A scope is open for this session but this code is not running inside it:
  // the writer reached here through a listener that lost the async context.
  // Say so rather than guess which call it belongs to.
  if (hasOpenScope(sessionId)) {
    log.warn('[artifact-registry] registration outside its call scope (wrap the listener with bindArtifactScope) sid=%s path=%s', sessionId, ref.path)
  }
}

/**
 * Keep a just-sealed delivery held by `holder` for the rest of this call, so
 * the transfer worker skips it until the reply-selection has run
 * (`docs/design/session-sync-zone-delivery-record.md`, E090-4). Returns false
 * when no call is open — a page download's own completion, a background
 * finalizer — where the producer releases the row for the worker itself.
 */
export function holdSealedDelivery(handle: DeliveryHandle): boolean {
  const scope = current.getStore()
  if (!scope || scope.ended) return false
  scope.heldDeliveries.set(handle.deliveryId, handle)
  return true
}

/**
 * Bind `fn` to the current call scope so it can register artifacts when it
 * runs later from an emitter that would otherwise lose the context.
 */
export function bindArtifactScope<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return AsyncResource.bind(fn)
}

/**
 * The remote connection the running tool call belongs to, or null when it is a
 * local session. A tool asks this when the answer changes where it writes —
 * `browser_download` puts a remote session's file in the zone so the agent can
 * reach it, instead of in this machine's Downloads folder.
 */
export function currentHostActionConnection(): string | null {
  return current.getStore()?.connectionId ?? null
}

/**
 * Whose zone the running call writes into: a node's connection id, `null` for
 * a local session's call, and `undefined` when no call is running at all —
 * the UI capturing from a device a session holds, a listener that lost its
 * context. The last is not "local": a marker that says `local` is what lets
 * the reclaim sweep delete, so code outside a call must not guess one.
 */
export function currentCallOwner(): string | null | undefined {
  const scope = current.getStore()
  if (!scope) return undefined
  return scope.connectionId && scope.connectionId !== 'local' ? scope.connectionId : null
}

/**
 * Run a LOCAL session's tool call inside a call scope, so producers it reaches
 * can tell "this desktop's own session" from "no idea who is calling".
 *
 * `currentCallOwner()` reports `undefined` outside any scope, and an unknown
 * owner marks nothing — which is right for a UI capture of a device a remote
 * session holds, and wrong for the local MCP dispatchers, whose calls are
 * local by construction. They open this scope so a zone directory they create
 * is marked `local` and the reclaim sweep can check it against this database.
 * No refs are collected: a local call has nothing to push to a node.
 */
export async function runInLocalCallScope<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  // A Host Action already opened a scope that names its node. Replacing it with
  // a local one would file a remote session's directory as this desktop's.
  if (current.getStore()) return run()
  const callId = randomUUID()
  try {
    return await collectArtifacts(sessionId, callId, run)
  } finally {
    takeArtifacts(sessionId, callId)
  }
}

/** Open a collection scope for one tool call and run it inside. */
export async function collectArtifacts<T>(
  sessionId: string,
  callId: string,
  run: () => Promise<T>,
  connectionId?: string,
): Promise<T> {
  const scope: Scope = { sessionId, callId, refs: new Map(), heldDeliveries: new Map(), ended: false, ...(connectionId ? { connectionId } : {}) }
  scopes.set(callId, scope)
  try {
    return await current.run(scope, run)
  } finally {
    scope.ended = true
    // Release the call's grip on everything it sealed: the rows go back to
    // holder = null, which is what the reply-selection that runs next
    // (`syncHostActionOutputs`) claims for a mentioned ref or abandons for an
    // unmentioned one — with no window in which the worker could take an
    // undecided file (E090-4).
    for (const handle of scope.heldDeliveries.values()) {
      try { releaseDelivery(handle) } catch (err) { log.warn('[artifact-registry] could not release a held delivery at scope end', err) } finally { retireHolder(handle.holder) }
    }
    scope.heldDeliveries.clear()
    // The scope stays registered until `takeArtifacts` reads it, so a caller that
    // awaits the tool result and then takes is never racing the `finally`.
    if (scope.refs.size === 0) scopes.delete(callId)
  }
}

/** Drain the refs one call registered. Clears them; a second take returns nothing. */
export function takeArtifacts(sessionId: string, callId: string): ArtifactRef[] {
  const scope = scopes.get(callId)
  if (!scope || scope.sessionId !== sessionId) return []
  scopes.delete(callId)
  return [...scope.refs.values()]
}

/** Tests only. */
export function resetArtifactRegistry(): void {
  scopes.clear()
}
