/**
 * How a connection's deliveries are shaped. The link tier sets the cost
 * controls (batching, projection, compression); the client surface sets the
 * presentation adapters. A policy is a parameter set, not a code path.
 */
export type LinkTier = 'local' | 'lan' | 'relay'
export type ClientSurface = 'desktop' | 'phone'

export interface DeliveryPolicy {
  tier: LinkTier
  surface: ClientSurface
}

/** Relay draft readers need the latest autosave, not every typing pause. */
export const DRAFT_SAVE_INTERVAL_MS = 5_000

/**
 * The route a connection actually uses. Taken from the path the supervisor or
 * phone link chose, never from the URL: an SSH forward is loopback.
 */
export type ConnectionRoute = 'ipc' | 'lan' | 'tailscale' | 'direct' | 'ssh' | 'relay'

export function tierOfRoute(route: ConnectionRoute): LinkTier {
  if (route === 'ipc') return 'local'
  if (route === 'relay') return 'relay'
  return 'lan'
}

/** Whether a connection receives transcripts summarized, their bodies behind `remoteDetail`. */
export function summarizesTranscripts(policy: DeliveryPolicy): boolean {
  return policy.surface === 'phone' || policy.tier === 'relay'
}

export function deliveryPolicy(route: ConnectionRoute, surface: ClientSurface): DeliveryPolicy {
  return { tier: tierOfRoute(route), surface }
}
