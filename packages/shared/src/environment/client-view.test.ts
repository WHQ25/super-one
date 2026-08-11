import { describe, expect, it } from 'vitest'
import {
  canRepairOverSsh,
  selectSshRepairProfile,
  type EndpointProfile,
} from './client-view'

const SSH: EndpointProfile = {
  endpointId: 'ssh',
  kind: 'ssh-forward',
  label: 'SSH',
  target: 'user@host',
}

const DIRECT: EndpointProfile = {
  endpointId: 'wss',
  kind: 'direct-wss',
  label: 'direct',
  target: 'wss://node.example',
}

describe('selectSshRepairProfile', () => {
  it('prefers preferred when it is SSH', () => {
    const other: EndpointProfile = { ...SSH, endpointId: 'ssh-b', target: 'user@b' }
    expect(selectSshRepairProfile([SSH, other], 'ssh-b')?.endpointId).toBe('ssh-b')
  })

  it('returns null when preferred is non-SSH even with an SSH backup', () => {
    expect(selectSshRepairProfile([DIRECT, SSH], 'wss')).toBeNull()
  })

  it('picks first SSH when preferred is unset', () => {
    expect(selectSshRepairProfile([SSH, DIRECT])?.endpointId).toBe('ssh')
  })
})

describe('canRepairOverSsh', () => {
  it('matches selectSshRepairProfile nullability', () => {
    expect(canRepairOverSsh({ endpointProfiles: [SSH], preferredEndpointId: 'ssh' })).toBe(true)
    expect(
      canRepairOverSsh({ endpointProfiles: [DIRECT, SSH], preferredEndpointId: 'wss' }),
    ).toBe(false)
  })
})
