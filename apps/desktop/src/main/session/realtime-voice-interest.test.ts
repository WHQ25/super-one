import { describe, expect, it, vi } from 'vitest'
import { RealtimeVoiceInterest } from './realtime-voice-interest'
import type { SessionOwner } from './types'

function fixture(chat: boolean) {
  let owner: SessionOwner = { kind: 'local' }
  const subscribers = new Set(chat ? ['phone'] : [])
  const release = vi.fn(() => { owner = { kind: 'local' } })
  const unsubscribe = vi.fn(() => { subscribers.delete('phone') })
  const interest = new RealtimeVoiceInterest({ owner: () => owner, subscribers: () => subscribers,
    claim: deviceId => { owner = { kind: 'remote', deviceId } }, subscribe: deviceId => { subscribers.add(deviceId) }, release, unsubscribe })
  return { interest, subscribers, release, unsubscribe, owner: () => owner }
}
describe('voice subscription interest', () => {
  it('retains authority/events across chat navigation, then releases both on hangup', () => {
    const f = fixture(true); const dispose = f.interest.retain('phone')
    expect(f.interest.releaseAllowed('phone', 'self_switch')).toBe(false)
    expect(f.interest.unsubscribeAllowed('phone', 'self_leave')).toBe(false)
    expect(f.subscribers.has('phone')).toBe(true)
    expect(f.owner()).toEqual({ kind: 'remote', deviceId: 'phone' })
    dispose(); dispose()
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('returning to the chat keeps its subscription after voice ends', () => {
    const f = fixture(false); const dispose = f.interest.retain('phone')
    f.interest.subscribed('phone'); dispose()
    expect(f.release).not.toHaveBeenCalled(); expect(f.unsubscribe).not.toHaveBeenCalled()
  })
  it('allows explicit device cleanup/kick and never grants local voice over remote control', () => {
    const f = fixture(false); const dispose = f.interest.retain('phone')
    expect(f.interest.releaseAllowed('phone', 'transport_disconnect')).toBe(true)
    expect(f.interest.unsubscribeAllowed('phone', 'desktop_kick')).toBe(true)
    expect(() => f.interest.retain()).toThrow(/controlled by a phone/)
    dispose()
  })
})
