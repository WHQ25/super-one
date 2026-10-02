import type { IpcMainInvokeEvent } from 'electron'
import { McpAppsError, type McpAppsBinding, type McpAppOrigin, type McpAppsProvider, type McpToolDescriptor } from '@superone/shared/mcp-apps'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'

/** Host-originated tool lookups (file entrypoints, mention search) shared by their IPC handlers. */

export function hostRpcFailure(error: unknown): McpAppsRpcResult<never> {
  return { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'invalid', message: error instanceof Error ? error.message : String(error) } }
}

export function assertHostRenderer(event: IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) throw new McpAppsError('denied', 'MCP App requests must come through the host renderer')
}

/**
 * `getSession` finds a loaded session; `resumeSession` also loads a persisted one without starting its harness.
 * Passive lookups never load a session; user actions may.
 */
export function hostSessionResolver(getSession: (id: string) => Session | null, resumeSession: (id: string) => Session) {
  return (id: string, passive: boolean): Session | null => {
    if (!id) return null
    if (passive) return getSession(id)
    try { return resumeSession(id) } catch { return null }
  }
}

export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new McpAppsError('timeout', 'MCP request timed out'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** A provider for this signal's lifetime; one that arrives after the deadline is disposed. */
export async function hostProvider(session: Session, binding: McpAppsBinding, origin: McpAppOrigin, signal: AbortSignal): Promise<McpAppsProvider> {
  if (!session.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
  const pending = session.getMcpAppsProvider(binding, origin)
  return untilAborted(pending, signal).catch((error: unknown) => {
    void pending.then(late => late.dispose(), () => {})
    throw error
  })
}

export interface HostToolCandidate { binding: McpAppsBinding; origin: McpAppOrigin; tool: McpToolDescriptor }

/**
 * Tools across the session's servers that `match` accepts; visibility is the caller's concern.
 * Servers are asked together: a cold harness starts them all at once, and one slow or
 * signed-out server must neither hide the others nor pass for "none" (`incomplete`).
 */
export async function findHostTools(session: Session, match: (tool: McpToolDescriptor) => boolean, signal: AbortSignal): Promise<{ candidates: HostToolCandidate[]; incomplete: boolean }> {
  if (!session.getMcpAppsHostBindings || !session.getMcpAppsProvider) return { candidates: [], incomplete: false }
  let incomplete = false
  const lists = await Promise.all((await session.getMcpAppsHostBindings()).map(async ({ binding, origin }) => {
    try {
      const provider = await hostProvider(session, binding, origin, signal)
      try {
        return [...(await untilAborted(provider.tools(), signal)).values()].filter(match).map(tool => ({ binding, origin, tool }))
      } finally { provider.dispose() }
    } catch {
      incomplete = true
      return []
    }
  }))
  return { candidates: lists.flat(), incomplete }
}
