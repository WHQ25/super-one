import type { EndpointProfile, EndpointProbeResult } from '@superone/shared/environment'

/**
 * Real endpoint probes used by NodeConnectionManager failover.
 * - direct-wss / tailscale: HTTP(S) /health
 * - ssh-forward: expects localBaseUrl already established (tunnel side)
 * - relay: lightweight relay frame handshake (opaque)
 */

export async function probeEndpointHealth(
  endpoint: EndpointProfile,
  opts?: { baseUrlOverride?: string; timeoutMs?: number },
): Promise<EndpointProbeResult> {
  const baseUrl = opts?.baseUrlOverride || resolveBaseUrl(endpoint)
  if (!baseUrl) {
    return { endpointId: endpoint.endpointId, ok: false, error: 'no base URL for endpoint' }
  }

  if (endpoint.kind === 'relay') {
    // No opaque frame transport adapter yet — never treat relay as connectable
    // via the ordinary HTTP/WS NodeRpcClient path.
    return {
      endpointId: endpoint.endpointId,
      ok: false,
      error: 'relay transport adapter not installed; endpoint unsupported',
      baseUrl,
    }
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 5_000)
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) {
      return { endpointId: endpoint.endpointId, ok: false, error: `health ${res.status}`, baseUrl }
    }
    const body = (await res.json()) as {
      ok?: boolean
      environmentId?: string
      nodePublicKeyFingerprint?: string
    }
    if (!body.ok || !body.environmentId || !body.nodePublicKeyFingerprint) {
      return { endpointId: endpoint.endpointId, ok: false, error: 'invalid health body', baseUrl }
    }
    return {
      endpointId: endpoint.endpointId,
      ok: true,
      environmentId: body.environmentId,
      nodePublicKeyFingerprint: body.nodePublicKeyFingerprint,
      baseUrl,
    }
  } catch (err) {
    return {
      endpointId: endpoint.endpointId,
      ok: false,
      error: (err as Error).message,
      baseUrl,
    }
  }
}

function resolveBaseUrl(endpoint: EndpointProfile): string | null {
  if (endpoint.kind === 'local') return null
  if (endpoint.kind === 'ssh-forward') {
    // SSH tunnels expose loopback; target may be host alias — baseUrl set by forward layer.
    if (endpoint.target.startsWith('http://') || endpoint.target.startsWith('https://')) {
      return endpoint.target
    }
    return null
  }
  // direct-wss, tailscale, relay store URL in target
  if (endpoint.target.startsWith('http://') || endpoint.target.startsWith('https://')) {
    return endpoint.target
  }
  if (endpoint.target.startsWith('ws://') || endpoint.target.startsWith('wss://')) {
    return endpoint.target.replace(/^ws/, 'http')
  }
  // Tailscale host:port form
  if (endpoint.kind === 'tailscale') {
    return endpoint.target.includes('://') ? endpoint.target : `http://${endpoint.target}`
  }
  return null
}

/**
 * Relay probe: GET {relayUrl}/health with role=environment is enough to confirm
 * reachability. Full opaque frame session is established after selection.
 */
async function probeRelay(
  endpoint: EndpointProfile,
  baseUrl: string,
  timeoutMs: number,
): Promise<EndpointProbeResult> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    // Prefer relay health; if absent, treat as opaque broker — require X-Env headers later.
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: ctrl.signal,
      headers: { 'x-superone-role': 'environment-probe' },
    })
    clearTimeout(timer)
    if (!res.ok) {
      // Relay may not expose /health — still selectable if TCP/TLS answered 404 with body.
      if (res.status === 404) {
        return {
          endpointId: endpoint.endpointId,
          ok: false,
          error: 'relay reachable but no environment identity without node bind',
          baseUrl,
        }
      }
      return { endpointId: endpoint.endpointId, ok: false, error: `relay ${res.status}`, baseUrl }
    }
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      environmentId?: string
      nodePublicKeyFingerprint?: string
    }
    if (body.environmentId && body.nodePublicKeyFingerprint) {
      return {
        endpointId: endpoint.endpointId,
        ok: true,
        environmentId: body.environmentId,
        nodePublicKeyFingerprint: body.nodePublicKeyFingerprint,
        baseUrl,
      }
    }
    return {
      endpointId: endpoint.endpointId,
      ok: false,
      error: 'relay health missing environment identity',
      baseUrl,
    }
  } catch (err) {
    return {
      endpointId: endpoint.endpointId,
      ok: false,
      error: (err as Error).message,
      baseUrl,
    }
  }
}

/** Discover a Tailscale Serve / IPv4 host from `tailscale status --json` when CLI is present. */
export async function discoverTailscaleHost(): Promise<string | null> {
  try {
    const { spawnSync } = await import('node:child_process')
    const result = spawnSync('tailscale', ['status', '--json'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    if (result.status !== 0 || !result.stdout) return null
    const json = JSON.parse(result.stdout) as {
      Self?: { DNSName?: string; TailscaleIPs?: string[] }
    }
    const ip = json.Self?.TailscaleIPs?.[0]
    if (ip) return ip
    const dns = json.Self?.DNSName?.replace(/\.$/, '')
    return dns || null
  } catch {
    return null
  }
}
