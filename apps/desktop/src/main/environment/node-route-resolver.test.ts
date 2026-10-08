import { describe, expect, it, vi } from 'vitest'
import { nodePairingEndpointProfiles, type EndpointProfile } from '@superone/shared/environment'
import { NodeRouteResolver, cachedNodeLanDiscovery, type NodeRouteTarget } from './node-route-resolver'

const ROOM = '0f'.repeat(16)
const target: NodeRouteTarget = {
  environmentId: 'env-b',
  nodePublicKeyFingerprint: 'fp-b',
  endpointProfiles: nodePairingEndpointProfiles({
    environmentId: 'env-b',
    lan: { host: 'Studio.local', port: 7791 },
    tailscaleHost: '100.80.0.2',
    relay: { url: 'wss://relay.example', room: ROOM },
    pairingToken: 't',
    channel: { keyId: 'k', secretHex: 'ab'.repeat(32) },
    expiresAt: 1,
  }),
  preferredEndpointId: 'lan',
}

function resolver(reachable: string[], discovered: string[] = []) {
  const probe = vi.fn(async (baseUrl: string) => reachable.includes(baseUrl))
  const discoverLan = vi.fn(async () => discovered)
  const openSshForward = vi.fn(async () => 'http://127.0.0.1:40000')
  return { routes: new NodeRouteResolver({ probe, discoverLan, openSshForward }), probe, discoverLan, openSshForward }
}

describe('NodeRouteResolver', () => {
  it('takes the mDNS LAN address first', async () => {
    const { routes } = resolver(['http://192.168.1.20:7791', 'http://Studio.local:7791'], ['http://192.168.1.20:7791'])
    await expect(routes.resolve(target)).resolves.toMatchObject({ path: 'lan', baseUrl: 'http://192.168.1.20:7791', endpointId: 'lan-mdns' })
  })

  it('falls through an unreachable LAN to Tailscale, then to the relay', async () => {
    const tailscale = resolver(['http://100.80.0.2:7791'])
    await expect(tailscale.routes.resolve(target)).resolves.toMatchObject({ path: 'tailscale', baseUrl: 'http://100.80.0.2:7791' })

    const relay = resolver([])
    const route = await relay.routes.resolve(target)
    expect(route).toMatchObject({ path: 'relay', baseUrl: 'wss://relay.example', endpointId: 'relay' })
    expect(typeof route?.dial).toBe('function')
    // The relay is the last resort and is not probed over HTTP.
    expect(relay.probe.mock.calls.map(([url]) => url)).toEqual(['http://Studio.local:7791', 'http://100.80.0.2:7791'])
  })

  it('uses a lone profile as-is and opens a preferred SSH forward', async () => {
    const lone: NodeRouteTarget = {
      environmentId: 'env-c',
      endpointProfiles: [{ endpointId: 'primary', kind: 'direct-wss', label: 'x', target: 'http://10.0.0.9:7788' }],
    }
    const { routes, probe, discoverLan } = resolver([])
    await expect(routes.resolve(lone)).resolves.toMatchObject({ path: 'lan', baseUrl: 'http://10.0.0.9:7788' })
    expect(probe).not.toHaveBeenCalled()
    // CLI nodes have no LAN hint, so they are not looked up over mDNS.
    expect(discoverLan).not.toHaveBeenCalled()

    const ssh: EndpointProfile = { endpointId: 'ssh', kind: 'ssh-forward', label: 'ssh', target: 'me@box' }
    const viaSsh = resolver([])
    await expect(viaSsh.routes.resolve({ environmentId: 'env-d', endpointProfiles: [ssh], preferredEndpointId: 'ssh' }))
      .resolves.toMatchObject({ path: 'ssh', baseUrl: 'http://127.0.0.1:40000' })
  })

  it('reports a better route only when one ahead of the current path answers', async () => {
    const offLan = resolver(['http://100.80.0.2:7791'])
    await expect(offLan.routes.betterThan(target, { path: 'relay' })).resolves.toBe(true)
    await expect(offLan.routes.betterThan(target, { path: 'tailscale' })).resolves.toBe(false)

    const backHome = resolver(['http://192.168.1.20:7791'], ['http://192.168.1.20:7791'])
    await expect(backHome.routes.betterThan(target, { path: 'relay' })).resolves.toBe(true)
    await expect(backHome.routes.betterThan(target, { path: 'lan' })).resolves.toBe(false)
  })
})

describe('cachedNodeLanDiscovery', () => {
  it('shares one browse across callers and matches by environment id', async () => {
    const browse = vi.fn(async () => [
      { instance: 'a', port: 7791, addresses: ['192.168.1.20'], txt: { env: 'env-b' } },
      { instance: 'b', port: 7792, addresses: ['192.168.1.30'], txt: { env: 'env-c' } },
    ])
    const discover = cachedNodeLanDiscovery(browse)
    await expect(discover('env-b')).resolves.toEqual(['http://192.168.1.20:7791'])
    await expect(discover('env-c')).resolves.toEqual(['http://192.168.1.30:7792'])
    expect(browse).toHaveBeenCalledTimes(1)
  })
})
