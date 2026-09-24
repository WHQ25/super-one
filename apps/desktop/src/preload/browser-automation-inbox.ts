export interface BrowserAutomationCall {
  callId: string
  sessionId: string
  op: string
  input: unknown
}

/**
 * Hold browser automation calls until the renderer's automation host subscribes.
 *
 * The preload exists long before React mounts that host — on a cold start the
 * gap is seconds (tens of seconds in dev, while Vite serves the module graph),
 * and the host layer also remounts when the app switches views. ipcRenderer
 * drops a message nobody listens to, so a call from an agent that was already
 * running left the main process waiting out its 30s timeout.
 *
 * A `cancel` for a call still held removes both: main has given up on it, and
 * running it late would, say, open a tab no caller knows about.
 */
export function createAutomationCallInbox() {
  let subscriber: ((call: BrowserAutomationCall) => void) | null = null
  const held: BrowserAutomationCall[] = []

  return {
    deliver(call: BrowserAutomationCall): void {
      if (subscriber) {
        subscriber(call)
        return
      }
      if (call.op === 'cancel') {
        const target = (call.input as { callId?: unknown } | null)?.callId
        const index = held.findIndex((pending) => pending.callId === target)
        if (index >= 0) {
          held.splice(index, 1)
          return
        }
        // Not held, so the call may still be running under the previous host;
        // its in-flight registry outlives a remount, so the next host can abort it.
      }
      held.push(call)
    },

    /** One host at a time: the app mounts exactly one automation host per window. */
    subscribe(callback: (call: BrowserAutomationCall) => void): () => void {
      subscriber = callback
      for (const call of held.splice(0)) callback(call)
      return () => {
        if (subscriber === callback) subscriber = null
      }
    },
  }
}
