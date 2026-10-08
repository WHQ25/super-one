import { describe, expect, it } from 'vitest'
import type { EndpointProfile } from './known-environment'
import { nodePairingEndpointProfiles } from './node-pairing-code'
import { nodeLinkPathOf, orderNodeRoutes } from './node-route'

const profiles = nodePairingEndpointProfiles({
  environmentId: 'env',
  lan: { host: 'Studio.local', port: 7791 },
  tailscaleHost: '100.80.1.2',
  relay: { url: 'wss://relay.example', room: '0f'.repeat(16) },
  pairingToken: 't',
  channel: { keyId: 'k', secretHex: 'ab'.repeat(32) },
  expiresAt: 1,
})

const ids = (routes: ReturnType<typeof orderNodeRoutes>) => routes.map((r) => `${r.path}:${r.profile.endpointId}`)

describe('orderNodeRoutes', () => {
  it('tries mDNS LAN, the stored LAN hint, Tailscale, then the relay', () => {
    const routes = orderNodeRoutes({
      profiles: [...profiles].reverse(),
      preferredEndpointId: 'lan',
      discoveredLanUrls: ['http://192.168.1.20:7791'],
    })
    expect(ids(routes)).toEqual(['lan:lan-mdns', 'lan:lan', 'tailscale:tailscale', 'relay:relay'])
  })

  it('keeps the relay last even when it is preferred', () => {
    expect(ids(orderNodeRoutes({ profiles, preferredEndpointId: 'relay' }))).toEqual([
      'lan:lan',
      'tailscale:tailscale',
      'relay:relay',
    ])
  })

  it('drops a stored profile mDNS already reports', () => {
    const routes = orderNodeRoutes({ profiles, discoveredLanUrls: ['http://Studio.local:7791'] })
    expect(ids(routes)).toEqual(['lan:lan-mdns', 'tailscale:tailscale', 'relay:relay'])
  })

  it('keeps the saved preference first and opens SSH only when preferred', () => {
    const ssh: EndpointProfile = { endpointId: 'ssh', kind: 'ssh-forward', label: 'ssh', target: 'me@box' }
    const ts: EndpointProfile = { endpointId: 'ts', kind: 'tailscale', label: 'ts', target: 'http://100.64.0.9:7788' }
    expect(ids(orderNodeRoutes({ profiles: [ts, ssh], preferredEndpointId: 'ssh' }))).toEqual(['ssh:ssh', 'tailscale:ts'])
    expect(ids(orderNodeRoutes({ profiles: [ssh, ts], preferredEndpointId: 'ts' }))).toEqual(['tailscale:ts'])
  })
})

describe('nodeLinkPathOf', () => {
  it.each([
    ['http://192.168.1.2:7791', 'lan'],
    ['http://Studio.local:7791', 'lan'],
    ['http://127.0.0.1:7791', 'lan'],
    ['http://100.70.0.1:7791', 'tailscale'],
    ['http://[fd7a:115c:a1e0::5]:7791', 'tailscale'],
    ['https://node.example.com', 'direct'],
  ])('%s is %s', (target, path) => {
    expect(nodeLinkPathOf({ endpointId: 'x', kind: 'direct-wss', label: 'x', target })).toBe(path)
  })
})
