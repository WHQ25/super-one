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
import log from '../logger'
import type { ArtifactProducer } from '../media-output-paths'

export interface ArtifactRef {
  /** Absolute desktop path. */
  path: string
  producer: ArtifactProducer
  /** False while the file is still being written (a recording that has started); re-registered when sealed. */
  final: boolean
}

interface Scope {
  sessionId: string
  callId: string
  /** Remote connection this call is a Host Action for; absent for a local session. */
  connectionId?: string
  refs: Map<string, ArtifactRef>
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
    bound.refs.set(ref.path, { ...ref })
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

/** Open a collection scope for one tool call and run it inside. */
export async function collectArtifacts<T>(
  sessionId: string,
  callId: string,
  run: () => Promise<T>,
  connectionId?: string,
): Promise<T> {
  const scope: Scope = { sessionId, callId, refs: new Map(), ...(connectionId ? { connectionId } : {}) }
  scopes.set(callId, scope)
  try {
    return await current.run(scope, run)
  } finally {
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
