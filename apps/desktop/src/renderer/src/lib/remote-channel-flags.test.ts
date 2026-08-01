import { describe, expect, it } from 'vitest'
import { enabledRemoteChannels, REMOTE_CHANNEL_ENABLED } from './remote-channel-flags'
import {
  channelForEnvironment,
  isLoopbackEnvironment,
} from '../components/settings/environments/EnvironmentsPage'
import type { EnvironmentListItem } from '@superone/shared/environment'

function remote(overrides: Partial<EnvironmentListItem> = {}): EnvironmentListItem {
  return {
    connectionId: 'c1',
    environmentId: 'e1',
    label: 'lab',
    kind: 'remote',
    state: 'connected',
    endpointProfiles: [
      {
        endpointId: 'ssh',
        kind: 'ssh-forward',
        label: 'SSH: lab',
        target: 'superone@lab',
      },
    ],
    preferredEndpointId: 'ssh',
    ...overrides,
  }
}

describe('remote channel flags', () => {
  it('only enables SSH for now', () => {
    expect(REMOTE_CHANNEL_ENABLED).toEqual({
      desktop: false,
      ssh: true,
      tailscale: false,
    })
    expect(enabledRemoteChannels()).toEqual(['ssh'])
  })
})

describe('channelForEnvironment', () => {
  it('maps ssh-forward endpoints to the ssh card', () => {
    expect(channelForEnvironment(remote())).toBe('ssh')
  })

  it('maps tailscale endpoints to the tailscale card', () => {
    expect(
      channelForEnvironment(
        remote({
          preferredEndpointId: 'ts',
          endpointProfiles: [
            { endpointId: 'ts', kind: 'tailscale', label: 'ts', target: '100.64.0.1' },
          ],
        }),
      ),
    ).toBe('tailscale')
  })

  it('maps direct desktop mesh to the desktop card', () => {
    expect(
      channelForEnvironment(
        remote({
          preferredEndpointId: 'd',
          endpointProfiles: [
            { endpointId: 'd', kind: 'direct-wss', label: 'peer', target: 'wss://peer' },
          ],
        }),
      ),
    ).toBe('desktop')
  })

  it('excludes loopback direct-wss (local lab) from channel cards', () => {
    const item = remote({
      preferredEndpointId: 'primary',
      endpointProfiles: [
        {
          endpointId: 'primary',
          kind: 'direct-wss',
          label: 'http://127.0.0.1:7789',
          target: 'http://127.0.0.1:7789',
        },
      ],
    })
    expect(isLoopbackEnvironment(item)).toBe(true)
    expect(channelForEnvironment(item)).toBeNull()
  })

  it('ignores the local environment', () => {
    expect(channelForEnvironment(remote({ kind: 'local' }))).toBeNull()
  })
})
