import type { EndpointProfile, KnownEnvironment } from './known-environment'

export interface EndpointProbeResult {
  endpointId: string
  ok: boolean
  /** Descriptor identity returned by the endpoint when ok. */
  environmentId?: string
  nodePublicKeyFingerprint?: string
  error?: string
  baseUrl?: string
}

/**
 * Select and fail over endpoints while preserving environment identity.
 * A candidate may only become preferred when it returns the same
 * environmentId + nodePublicKeyFingerprint as the KnownEnvironment binding.
 */
export async function selectEndpointWithFailover(input: {
  known: KnownEnvironment
  /**
   * Probe an endpoint. Implementations open health or descriptor without
   * mutating remote state. Must not import Electron.
   */
  probe: (endpoint: EndpointProfile) => Promise<EndpointProbeResult>
  preferredFirst?: boolean
}): Promise<EndpointProbeResult & { selected: true } | { selected: false; attempts: EndpointProbeResult[] }> {
  const ordered = orderEndpoints(input.known, input.preferredFirst !== false)
  const attempts: EndpointProbeResult[] = []

  for (const endpoint of ordered) {
    let result: EndpointProbeResult
    try {
      result = await input.probe(endpoint)
    } catch (err) {
      result = {
        endpointId: endpoint.endpointId,
        ok: false,
        error: (err as Error).message,
      }
    }
    attempts.push(result)
    if (!result.ok) continue

    if (result.environmentId !== input.known.environmentId) {
      attempts[attempts.length - 1] = {
        ...result,
        ok: false,
        error: `environment identity mismatch on endpoint ${endpoint.endpointId}`,
      }
      continue
    }
    if (result.nodePublicKeyFingerprint !== input.known.nodePublicKeyFingerprint) {
      attempts[attempts.length - 1] = {
        ...result,
        ok: false,
        error: `node fingerprint mismatch on endpoint ${endpoint.endpointId}`,
      }
      continue
    }

    return { ...result, selected: true }
  }

  return { selected: false, attempts }
}

export function orderEndpoints(known: KnownEnvironment, preferredFirst: boolean): EndpointProfile[] {
  const profiles = [...known.endpointProfiles]
  if (!preferredFirst || !known.preferredEndpointId) return profiles
  const pref = profiles.find((p) => p.endpointId === known.preferredEndpointId)
  if (!pref) return profiles
  return [pref, ...profiles.filter((p) => p.endpointId !== pref.endpointId)]
}

/** Build a Tailscale endpoint profile from a tailnet host. */
export function tailscaleEndpoint(input: {
  endpointId?: string
  host: string
  port?: number
  label?: string
}): EndpointProfile {
  const port = input.port ?? 7788
  return {
    endpointId: input.endpointId ?? 'tailscale',
    kind: 'tailscale',
    label: input.label ?? `Tailscale ${input.host}`,
    target: `http://${input.host}:${port}`,
  }
}

/** Build a relay endpoint profile (opaque broker URL). */
export function relayEndpoint(input: {
  endpointId?: string
  relayUrl: string
  label?: string
}): EndpointProfile {
  return {
    endpointId: input.endpointId ?? 'relay',
    kind: 'relay',
    label: input.label ?? 'Environment relay',
    target: input.relayUrl,
  }
}
