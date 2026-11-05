/**
 * An empty draft keeps one SuperOne session id when the ACP agent changes.
 * Grok's initialization `message_usage` can still be in flight after the
 * click. Hold context fields until the new agent's catalog arrives, then
 * accept that runtime's readings.
 */
const holdBySessionId = new Map<string, string>()

export function holdContextUsageUntilAgent(sessionId: string, agentId: string): void {
  holdBySessionId.set(sessionId, agentId)
}

export function clearContextUsageHold(sessionId: string | null | undefined): void {
  if (sessionId) holdBySessionId.delete(sessionId)
}

export function isContextUsageHeld(sessionId: string): boolean {
  return holdBySessionId.has(sessionId)
}

export function releaseContextUsageHold(sessionId: string, agentId: string | null | undefined): void {
  if (agentId && holdBySessionId.get(sessionId) === agentId) holdBySessionId.delete(sessionId)
}

export function clearAllContextUsageHolds(): void {
  holdBySessionId.clear()
}
