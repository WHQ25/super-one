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
 * writer deep inside a tool needs only the session id; when a callback has
 * lost its async context, the most recent open scope for that session takes
 * the ref instead. Outside any scope — local sessions, manual UI captures —
 * registration is a no-op, so nothing accumulates.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
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
  refs: Map<string, ArtifactRef>
}

const scopes = new Map<string, Scope>()
const current = new AsyncLocalStorage<Scope>()

function scopeFor(sessionId: string): Scope | undefined {
  const bound = current.getStore()
  if (bound && bound.sessionId === sessionId) return bound
  let latest: Scope | undefined
  for (const scope of scopes.values()) if (scope.sessionId === sessionId) latest = scope
  return latest
}

/** Record a file the session's caller may be handed a path to. Later registrations of one path replace earlier ones. */
export function registerArtifact(sessionId: string, ref: ArtifactRef): void {
  scopeFor(sessionId)?.refs.set(ref.path, { ...ref })
}

/** Open a collection scope for one tool call and run it inside. */
export async function collectArtifacts<T>(sessionId: string, callId: string, run: () => Promise<T>): Promise<T> {
  const scope: Scope = { sessionId, callId, refs: new Map() }
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
