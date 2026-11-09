import { afterEach, expect, it } from 'vitest'
import { VoiceAdmissionHost, type VoiceSeat } from './realtime-voice-admission'
import type { VoiceLink } from './realtime-voice-admission'

const hosts: VoiceAdmissionHost[] = []

afterEach(() => {
  for (const host of hosts) host.reset()
  hosts.length = 0
})

function seat(endpointId = 'window-1'): VoiceSeat {
  return {
    endpointId,
    sessionId: 'session-1',
    projectPath: '/repo',
    capability: { protocol: 1, supported: false, reason: 'Voice is unavailable for this agent.' },
    busy: true,
    apiProviderId: 'custom-credential',
    send: () => {},
  }
}

function link(): VoiceLink {
  return { start: async () => {}, stop: async () => {} }
}

it('admits a Doubao shell without an offer or a Codex account', () => {
  const host = new VoiceAdmissionHost()
  hosts.push(host)
  const status = host.startShell(seat(), 'attempt-1', link)
  expect(status.call).toMatchObject({ state: 'starting', owned: true, attemptId: 'attempt-1', sessionId: 'session-1' })
})

it('keeps the exact desktop busy sentence for a second call', () => {
  const host = new VoiceAdmissionHost()
  hosts.push(host)
  host.startShell(seat(), 'attempt-1', link)
  expect(() => host.startShell(seat('window-2'), 'attempt-2', link)).toThrow(
    'Another voice call is already starting or active on this desktop.',
  )
})

it('still rejects a Codex start that has no offer', () => {
  const host = new VoiceAdmissionHost()
  hosts.push(host)
  expect(() => host.start(seat(), 'attempt-1', { attemptId: 'attempt-1', sdp: '' }, link)).toThrow(/Invalid voice offer/)
})
