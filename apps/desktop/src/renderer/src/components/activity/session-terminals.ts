import { parseRemoteTerminalKey, remoteSessionKey } from '@superone/shared/remote-resource-key'

/**
 * Session whose activity panel owns this PTY. A remote terminal's agent id is
 * joined with the node connection, matching `projectSessionKey`. User-opened
 * tabs have no agent session and stay with whichever layout docked them.
 */
export function terminalLayoutOwner(item: { terminalId: string; agentSessionId?: string }): string | undefined {
  const remote = parseRemoteTerminalKey(item.terminalId)
  return remote && item.agentSessionId ? remoteSessionKey(remote.connectionId, item.agentSessionId) : item.agentSessionId
}

export interface SessionTerminalRef {
  terminalId: string
  title: string
  layoutKey: string
}

const byId = new Map<string, SessionTerminalRef>()
const listeners = new Set<() => void>()
let revision = 0

function emit(): void {
  revision += 1
  for (const listener of listeners) listener()
}

/** An agent-opened PTY, including one not yet docked because its session is parked. */
export function rememberSessionTerminal(ref: SessionTerminalRef): void {
  const prev = byId.get(ref.terminalId)
  if (prev && prev.title === ref.title && prev.layoutKey === ref.layoutKey) return
  byId.set(ref.terminalId, ref)
  emit()
}

export function forgetSessionTerminal(terminalId: string): void {
  if (!byId.delete(terminalId)) return
  emit()
}

export function sessionTerminals(layoutKey: string): SessionTerminalRef[] {
  const out: SessionTerminalRef[] = []
  for (const ref of byId.values()) if (ref.layoutKey === layoutKey) out.push(ref)
  return out
}

export function subscribeSessionTerminals(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function sessionTerminalRevision(): number {
  return revision
}

export function resetSessionTerminalsForTest(): void {
  if (byId.size === 0) return
  byId.clear()
  emit()
}
