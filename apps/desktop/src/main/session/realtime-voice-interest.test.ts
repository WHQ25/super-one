import { describe, expect, it, vi } from 'vitest'
import { RealtimeVoiceInterest } from './realtime-voice-interest'

describe('voice runtime interest', () => {
  it('pins only the call and releases its exact control retention once', () => {
    const release = vi.fn()
    const interest = new RealtimeVoiceInterest(() => release)
    const dispose = interest.retain('a')
    expect(interest.active()).toBe(true)
    expect(interest.active('a')).toBe(true)
    expect(interest.active('b')).toBe(false)
    dispose(); dispose()
    expect(interest.active()).toBe(false)
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('does not pin a call whose control admission failed', () => {
    const interest = new RealtimeVoiceInterest(() => { throw new Error('lease stale') })
    expect(() => interest.retain('a')).toThrow('lease stale')
    expect(interest.active()).toBe(false)
  })
})
