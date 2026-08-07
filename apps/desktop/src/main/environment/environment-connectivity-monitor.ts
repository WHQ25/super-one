/**
 * Wires OS lifecycle signals into EnvironmentHost wake/auto-connect.
 * Kept separate from EnvironmentHost so unit tests can inject fake signals.
 */

export interface EnvironmentConnectivityDeps {
  /** Electron powerMonitor 'resume' or equivalent. */
  onResume: (handler: () => void) => void
  /** Subscribe to online transitions; return unsubscribe. */
  onOnlineEdge: (handler: () => void) => () => void
  startDesiredConnections: () => Promise<void>
  wakeDesiredConnections: (
    reason: 'app-resume' | 'network-online' | 'network-offline',
  ) => Promise<void>
  log?: (message: string) => void
}

/**
 * Start auto-connect of desired remotes and attach resume/online wake handlers.
 * Returns a disposer that removes listeners.
 */
export function attachEnvironmentConnectivityMonitor(
  deps: EnvironmentConnectivityDeps,
): () => void {
  const log = deps.log ?? (() => {})
  void deps.startDesiredConnections().catch((err) => {
    log(
      `[environment] startDesiredConnections failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  })

  const onResume = (): void => {
    log('[environment] system resume → wake desired connections')
    void deps.wakeDesiredConnections('app-resume').catch((err) => {
      log(
        `[environment] wakeDesiredConnections(app-resume) failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }
  deps.onResume(onResume)

  const unsubOnline = deps.onOnlineEdge(() => {
    log('[environment] network online → wake desired connections')
    void deps.wakeDesiredConnections('network-online').catch((err) => {
      log(
        `[environment] wakeDesiredConnections(network-online) failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  })

  return () => {
    unsubOnline()
  }
}

/**
 * Poll net.isOnline() and fire when false→true.
 * Electron's net module has no dedicated online event on all platforms.
 */
export function createOnlineEdgeWatcher(
  isOnline: () => boolean,
  intervalMs = 2_000,
): {
  onOnlineEdge: (handler: () => void) => () => void
  onOfflineEdge: (handler: () => void) => () => void
  stop: () => void
} {
  const handlers = new Set<() => void>()
  let wasOnline = isOnline()
  const offlineHandlers = new Set<() => void>()
  const timer = setInterval(() => {
    const online = isOnline()
    if (online && !wasOnline) {
      for (const h of handlers) h()
    } else if (!online && wasOnline) {
      for (const h of offlineHandlers) h()
    }
    wasOnline = online
  }, intervalMs)
  // Don't keep the process alive solely for this poller in tests.
  if (typeof timer === 'object' && 'unref' in timer) {
    ;(timer as NodeJS.Timeout).unref?.()
  }

  return {
    onOnlineEdge(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    onOfflineEdge(handler: () => void) {
      offlineHandlers.add(handler)
      return () => {
        offlineHandlers.delete(handler)
      }
    },
    stop() {
      clearInterval(timer)
      handlers.clear()
      offlineHandlers.clear()
    },
  }
}
