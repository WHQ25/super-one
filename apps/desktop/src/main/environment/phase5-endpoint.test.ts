import { describe, expect, it, vi } from 'vitest'
import {
  selectEndpointWithFailover,
  tailscaleEndpoint,
  relayEndpoint,
  ConnectionSupervisorCore,
} from '@superone/shared/environment'
import type { KnownEnvironment } from '@superone/shared/environment'

/**
 * Phase 5: desktop uses shared electron-free cores for endpoint failover.
 * Identity must be preserved across Tailscale/relay/ssh-forward candidates.
 */
describe('Phase 5 endpoint identity + electron-free core', () => {
  it('fails over from SSH forward to Tailscale with same environment binding', async () => {
    const known: KnownEnvironment = {
      connectionId: 'c',
      environmentId: 'env-stable',
      nodePublicKeyFingerprint: 'fp-stable',
      label: 'linux',
      preferredEndpointId: 'ssh',
      endpointProfiles: [
        { endpointId: 'ssh', kind: 'ssh-forward', label: 'SSH', target: 'user@host' },
        tailscaleEndpoint({ host: '100.64.1.2', endpointId: 'ts' }),
        relayEndpoint({ relayUrl: 'wss://relay.example/r', endpointId: 'rel' }),
      ],
      createdAt: 1,
      updatedAt: 1,
    }

    const selected = await selectEndpointWithFailover({
      known,
      probe: async (ep) => {
        if (ep.kind === 'ssh-forward') {
          return { endpointId: ep.endpointId, ok: false, error: 'ssh down' }
        }
        if (ep.kind === 'tailscale') {
          return {
            endpointId: ep.endpointId,
            ok: true,
            environmentId: 'env-stable',
            nodePublicKeyFingerprint: 'fp-stable',
            baseUrl: ep.target,
          }
        }
        return { endpointId: ep.endpointId, ok: false, error: 'unused' }
      },
    })

    expect(selected.selected).toBe(true)
    if (selected.selected) {
      expect(selected.environmentId).toBe(known.environmentId)
      expect(selected.nodePublicKeyFingerprint).toBe(known.nodePublicKeyFingerprint)
      expect(selected.endpointId).toBe('ts')
    }
  })

  it('blocks failover when fingerprint changes', async () => {
    const known: KnownEnvironment = {
      connectionId: 'c',
      environmentId: 'env-stable',
      nodePublicKeyFingerprint: 'fp-stable',
      label: 'linux',
      endpointProfiles: [tailscaleEndpoint({ host: '100.64.1.2' })],
      createdAt: 1,
      updatedAt: 1,
    }
    const selected = await selectEndpointWithFailover({
      known,
      probe: async (ep) => ({
        endpointId: ep.endpointId,
        ok: true,
        environmentId: 'env-stable',
        nodePublicKeyFingerprint: 'fp-CLONE',
        baseUrl: ep.target,
      }),
    })
    expect(selected.selected).toBe(false)
  })

  it('uses ConnectionSupervisorCore from shared (no electron import in core path)', async () => {
    const connect = vi.fn(async () => {})
    const core = new ConnectionSupervisorCore({
      environmentId: 'e',
      connectionId: 'c',
      connect,
    })
    await core.start()
    expect(connect).toHaveBeenCalled()
    expect(core.getSnapshot().state).toBe('connected')
    core.dispose()
  })
})
