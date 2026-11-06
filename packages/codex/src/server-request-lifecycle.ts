/** Request IDs are connection-local and retain their JSON-RPC string/number identity. */
interface PendingRequest {
  threadId: unknown
  turnId: unknown
  controller: AbortController
  claimed: boolean
  resolved: boolean
  finished: boolean
}
const connections = new WeakMap<object, Map<string | number, PendingRequest>>()

export function registerCodexServerRequest(connection: object, id: string | number, params: Record<string, unknown>): PendingRequest {
  let requests = connections.get(connection)
  if (!requests) { requests = new Map(); connections.set(connection, requests) }
  let pending = requests.get(id)
  if (!pending) {
    pending = { threadId: params.threadId ?? params.thread_id, turnId: params.turnId ?? params.turn_id, controller: new AbortController(), claimed: false, resolved: false, finished: false }
    requests.set(id, pending)
  }
  return pending
}

export function claimCodexServerRequest(connection: object, id: string | number, params: Record<string, unknown>): PendingRequest | null {
  const pending = registerCodexServerRequest(connection, id, params)
  if (pending.claimed) return null
  pending.claimed = true
  if (pending.resolved) { finishCodexServerRequest(connection, id, pending); return null }
  return pending
}

/** An acknowledgement can precede consumption of a queued request. Retain it until claimed. */
export function resolveCodexServerRequest(connection: object, params: Record<string, unknown>): void {
  const id = params.requestId
  if (typeof id !== 'string' && typeof id !== 'number') return
  const pending = connections.get(connection)?.get(id)
  if (!pending || pending.threadId !== params.threadId) return
  pending.resolved = true
  pending.controller.abort()
  if (pending.finished) connections.get(connection)?.delete(id)
}

export function finishCodexServerRequest(connection: object, id: string | number, pending: PendingRequest): void {
  pending.finished = true
  // Retain answered requests until acknowledgement to deduplicate server replays.
  if (pending.resolved && connections.get(connection)?.get(id) === pending) connections.get(connection)?.delete(id)
}

export function cancelCodexServerRequests(connection: object): void {
  const requests = connections.get(connection)
  connections.delete(connection)
  for (const pending of requests?.values() ?? []) {
    pending.resolved = true
    pending.controller.abort()
  }
}

/** A turn ending cannot leave one of its native approvals actionable. Other child turns stay live. */
export function resolveCodexTurnRequests(connection: object, params: Record<string, unknown>): void {
  const turn = params.turn && typeof params.turn === 'object' ? params.turn as Record<string, unknown> : undefined
  if (typeof params.threadId !== 'string' || typeof turn?.id !== 'string') return
  for (const [id, pending] of connections.get(connection) ?? []) {
    if (pending.threadId === params.threadId && pending.turnId === turn.id) resolveCodexServerRequest(connection, { threadId: params.threadId, requestId: id })
  }
}
