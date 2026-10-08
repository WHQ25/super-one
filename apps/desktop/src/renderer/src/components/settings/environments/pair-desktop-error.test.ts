import { describe, expect, it } from 'vitest'
import { classifyPairDesktopError } from './pair-desktop-error'

const IPC = "Error invoking remote method 'environment:pairRemote': Error: "
const WRAP = 'pair request failed for remote node endpoint http://studio.local:7791/v1/pair: '

describe('classifyPairDesktopError', () => {
  it.each([
    [`${IPC}pairing token expired`, 'expired'],
    [`${IPC}pairing token already used`, 'used'],
    [`${IPC}invalid pairing token`, 'rejected'],
    [`${IPC}pairing token revoked`, 'rejected'],
    [`${IPC}this node accepts requests only inside its encrypted channel`, 'channelRequired'],
    [`${IPC}${WRAP}encrypted channel closed during handshake (4401 channel_auth_failed)`, 'channelAuth'],
    [`${IPC}${WRAP}server did not prove the pairing secret`, 'channelAuth'],
    [`${IPC}${WRAP}connect ECONNREFUSED 192.168.1.20:7791`, 'unreachable'],
    [`${IPC}${WRAP}getaddrinfo ENOTFOUND studio.local`, 'unreachable'],
    [`${IPC}${WRAP}encrypted auth request timeout`, 'unreachable'],
    [`${IPC}${WRAP}encrypted channel closed during handshake (1006 no reason)`, 'unreachable'],
  ])('%s → %s', (message, expected) => {
    expect(classifyPairDesktopError(message)).toBe(expected)
  })

  it('leaves unknown failures to the raw message', () => {
    expect(classifyPairDesktopError(`${IPC}failed to store node credentials: keychain locked`)).toBeNull()
  })
})
