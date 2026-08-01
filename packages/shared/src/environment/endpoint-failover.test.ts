import { describe, expect, it } from 'vitest'
import {
  orderEndpoints,
  relayEndpoint,
  selectEndpointWithFailover,
  tailscaleEndpoint,
} from './endpoint-failover'
import type { KnownEnvironment } from './known-environment'
import { assertRelayOpaque, decodeRelayFrame, encodeRelayFrame } from './relay-framing'
import { ConnectionSupervisorCore } from './connection-supervisor-core'

const known: KnownEnvironment = {
  connectionId: 'c1',
  environmentId: 'env-1',
  nodePublicKeyFingerprint: 'fp-1',
  label: 'box',
  preferredEndpointId: 'ssh',
  endpointProfiles: [
    { endpointId: 'ssh', kind: 'ssh-forward', label: 'SSH', target: 'user@host' },
    tailscaleEndpoint({ host: '100.64.0.2', port: 7788 }),
    relayEndpoint({ relayUrl: 'wss://relay.example/env' }),
  ],
  createdAt: 0,
  updatedAt: 0,
}

describe('endpoint failover', () => {
  it('prefers preferred endpoint then fails over while preserving identity', async () => {
    const order: string[] = []
    const result = await selectEndpointWithFailover({
      known,
      probe: async (ep) => {
        order.push(ep.endpointId)
        if (ep.endpointId === 'ssh') {
          return { endpointId: ep.endpointId, ok: false, error: 'tunnel down' }
        }
        if (ep.kind === 'tailscale') {
          return {
            endpointId: ep.endpointId,
            ok: true,
            environmentId: 'env-1',
            nodePublicKeyFingerprint: 'fp-1',
            baseUrl: ep.target,
          }
        }
        return { endpointId: ep.endpointId, ok: false, error: 'skip' }
      },
    })
    expect(order[0]).toBe('ssh')
    expect(result.selected).toBe(true)
    if (result.selected) {
      expect(result.endpointId).toBe('tailscale')
      expect(result.environmentId).toBe('env-1')
      expect(result.nodePublicKeyFingerprint).toBe('fp-1')
    }
  })

  it('rejects endpoints that return a different identity (clone/wrong host)', async () => {
    const result = await selectEndpointWithFailover({
      known,
      probe: async (ep) => ({
        endpointId: ep.endpointId,
        ok: true,
        environmentId: 'env-OTHER',
        nodePublicKeyFingerprint: 'fp-OTHER',
        baseUrl: ep.target,
      }),
    })
    expect(result.selected).toBe(false)
    if (!result.selected) {
      expect(result.attempts.every((a) => !a.ok)).toBe(true)
      expect(result.attempts.some((a) => a.error?.includes('identity'))).toBe(true)
    }
  })

  it('orders preferred first', () => {
    const ordered = orderEndpoints(known, true)
    expect(ordered[0]?.endpointId).toBe('ssh')
  })
})

describe('relay framing', () => {
  it('round-trips opaque frames without application fields', () => {
    const frame = {
      header: {
        routeId: 'route-1',
        connectionGeneration: 3,
        payloadBytes: 16,
      },
      ciphertext: Buffer.from('encrypted-payload').toString('base64url'),
    }
    const encoded = encodeRelayFrame(frame)
    expect(encoded).not.toContain('sessions.send')
    assertRelayOpaque(frame)
    expect(decodeRelayFrame(encoded)).toEqual(frame)
  })
})

describe('ConnectionSupervisorCore (electron-free)', () => {
  it('connects without requiring Electron APIs', async () => {
    const s = new ConnectionSupervisorCore({
      environmentId: 'e',
      connectionId: 'c',
      connect: async () => {},
    })
    await s.start()
    expect(s.getSnapshot().state).toBe('connected')
    s.dispose()
  })
})
