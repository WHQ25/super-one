const timers = new Map<string, ReturnType<typeof setTimeout>>()

const DEFAULT_DEBOUNCE_MS = 300

/**
 * Debounce a per-session MCP reload. Coalesces tool-change bursts (e.g. an app
 * registering several tools at once) into one reload, and — crucially — lets the
 * pending timer be cancelled on session dispose via {@link cancelMcpReload}, so a
 * reload never fires against a torn-down session.
 */
export function scheduleMcpReload(sessionId: string, run: () => void, delayMs = DEFAULT_DEBOUNCE_MS): void {
  const existing = timers.get(sessionId)
  if (existing) clearTimeout(existing)
  timers.set(sessionId, setTimeout(() => {
    timers.delete(sessionId)
    run()
  }, delayMs))
}

export function cancelMcpReload(sessionId: string): void {
  const existing = timers.get(sessionId)
  if (existing) {
    clearTimeout(existing)
    timers.delete(sessionId)
  }
}

export function hasPendingMcpReload(sessionId: string): boolean {
  return timers.has(sessionId)
}
